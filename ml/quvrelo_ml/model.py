"""QuvSelect: a compact encoder-decoder for subject selection and click-prompted object selection.

One network serves both "Select Subject" and click-to-select:

  input  [B, 6, H, W]  = RGB (ImageNet-normalised) + positive-click map + negative-click map + previous mask
  output [B, 1, H, W]  = mask logits

With all three prompt channels zero the network predicts the salient subject. With clicks it predicts the
clicked object; the previous-mask channel lets the app iterate (add/remove clicks refine the last result).

Encoder: Fused-MBConv residual blocks (trained from scratch, no pretrained weights).
Decoder: U-Net-lite with depthwise-separable fusion at strides 16/8/4/2; the prompt maps are also
injected at stride 4 so clicks keep their spatial precision. H and W must be multiples of 32.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


def conv_bn(i, o, k=3, s=1, g=1, act=True):
    layers = [nn.Conv2d(i, o, k, s, k // 2, groups=g, bias=False), nn.BatchNorm2d(o)]
    if act:
        layers.append(nn.ReLU6(inplace=True))
    return nn.Sequential(*layers)


class InvRes(nn.Module):
    """Fused-MBConv block (EfficientNetV2 style): dense 3x3 then 1x1 projection.
    Chosen over depthwise inverted residuals because depthwise backward is slow on CPU training."""

    def __init__(self, i, o, s, e=4):
        super().__init__()
        h = max(i, o)
        self.use_res = s == 1 and i == o
        self.b = nn.Sequential(conv_bn(i, h, 3, s), conv_bn(h, o, 1, act=False))

    def forward(self, x):
        y = self.b(x)
        return x + y if self.use_res else y


def stage(i, o, n, s, e=4):
    return nn.Sequential(InvRes(i, o, s, e), *[InvRes(o, o, 1, e) for _ in range(n - 1)])


class SepFuse(nn.Module):
    """depthwise-separable 3x3 conv block used in the decoder"""

    def __init__(self, i, o):
        super().__init__()
        self.b = nn.Sequential(conv_bn(i, i, 3, g=i), conv_bn(i, o, 1), conv_bn(o, o, 3, g=o), conv_bn(o, o, 1))

    def forward(self, x):
        return self.b(x)


class ContextLite(nn.Module):
    """1x1 + 3x3 + global-pool context at stride 32 (no dilated convs: their CPU backward is very slow)"""

    def __init__(self, c, o):
        super().__init__()
        self.b0 = conv_bn(c, o, 1)
        self.b1 = conv_bn(c, o, 3)
        self.gp = conv_bn(c, o, 1)
        self.proj = conv_bn(3 * o, o, 1)

    def forward(self, x):
        g = self.gp(x.mean((2, 3), keepdim=True)).expand(-1, -1, x.shape[2], x.shape[3])
        return self.proj(torch.cat([self.b0(x), self.b1(x), g], 1))


class QuvSelect(nn.Module):
    def __init__(self, width=1.0):
        super().__init__()
        c = [int(round(v * width)) for v in (16, 24, 40, 80, 128)]
        self.stem = conv_bn(6, c[0], 3, 2)  # /2
        self.s1 = stage(c[0], c[0], 1, 1, e=2)  # /2
        self.s2 = stage(c[0], c[1], 2, 2)  # /4
        self.s3 = stage(c[1], c[2], 3, 2)  # /8
        self.s4 = stage(c[2], c[3], 3, 2)  # /16
        self.s5 = stage(c[3], c[4], 3, 2)  # /32
        d = 64
        self.aspp = ContextLite(c[4], d)
        self.f4 = SepFuse(d + c[3], d)
        self.f3 = SepFuse(d + c[2], 48)
        self.f2 = SepFuse(48 + c[1] + 3, 32)  # +3 prompt maps re-injected at /4
        self.f1 = SepFuse(32 + c[0], 16)
        self.head = nn.Conv2d(16, 1, 1)

    @staticmethod
    def up(x, ref):
        return F.interpolate(x, size=ref.shape[2:], mode="bilinear", align_corners=False)

    def forward(self, x):
        p = x[:, 3:6]
        x1 = self.s1(self.stem(x))
        x2 = self.s2(x1)
        x3 = self.s3(x2)
        x4 = self.s4(x3)
        x5 = self.s5(x4)
        y = self.aspp(x5)
        y = self.f4(torch.cat([self.up(y, x4), x4], 1))
        y = self.f3(torch.cat([self.up(y, x3), x3], 1))
        p4 = F.interpolate(p, size=x2.shape[2:], mode="bilinear", align_corners=False)
        y = self.f2(torch.cat([self.up(y, x2), x2, p4], 1))
        y = self.f1(torch.cat([self.up(y, x1), x1], 1))
        y = self.head(y)
        return F.interpolate(y, size=x.shape[2:], mode="bilinear", align_corners=False)


if __name__ == "__main__":
    import time

    m = QuvSelect().eval()
    n = sum(p.numel() for p in m.parameters())
    print(f"params {n/1e6:.2f}M  ~{n*4/1e6:.1f} MB fp32")
    x = torch.randn(1, 6, 320, 320)
    with torch.no_grad():
        m(x)
        t = time.time()
        for _ in range(5):
            m(x)
    print(f"320x320 cpu {(time.time()-t)/5*1000:.0f} ms")
