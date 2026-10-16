"""QuvSelect v1: ImageNet-pretrained MobileNetV3-Large encoder + light FPN decoder, prompt-conditioned.

Same I/O contract as v0 (so the app pipeline is unchanged):
  input  float32 [1, 6, H, W]  (H, W multiples of 32): ImageNet-normalised RGB, +click map, -click map, previous mask
  output float32 [1, 1, H, W]  logits

Encoder: timm `mobilenetv3_large_100.ra_in1k` (Apache-2.0 weights, see ml/DATA_SOURCES.md), used as blocks so the
prompt channels can be injected *inside* the encoder: a small prompt encoder produces features at stride 4, 8 and 16
that are added (through zero-initialised 1x1 projections) to the inputs of encoder stages 2, 3 and 5. At step 0 the
network is therefore exactly the pretrained RGB encoder, and click conditioning is learned on top of it.
The prompts are fed again at stride 4 in the decoder for spatial precision (as in v0).

The stem and stages 0-1 (stride 2-4, the expensive high-resolution layers) can be frozen for fast CPU fine-tuning.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

BACKBONE = "mobilenetv3_large_100.ra_in1k"


def cbr(i, o, k=3, s=1, groups=1):
    return nn.Sequential(nn.Conv2d(i, o, k, s, k // 2, groups=groups, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


def dsconv(i, o):
    return nn.Sequential(cbr(i, i, 3, groups=i), cbr(i, o, 1))


class QuvSelectV1(nn.Module):
    def __init__(self, pretrained=True, dec=64):
        super().__init__()
        import timm
        m = timm.create_model(BACKBONE, pretrained=pretrained)
        self.stem = nn.Sequential(m.conv_stem, m.bn1)
        self.b = m.blocks  # 0:16@2 1:24@4 2:40@8 3:80@16 4:112@16 5:160@32 6:960@32
        # prompt encoder (3 channels: +clicks, -clicks, previous mask)
        self.p4 = nn.Sequential(cbr(3, 16, 3, 2), cbr(16, 24, 3, 2))       # stride 4
        self.p8 = cbr(24, 32, 3, 2)                                          # stride 8
        self.p16 = cbr(32, 48, 3, 2)                                         # stride 16
        self.inj4 = nn.Conv2d(24, 24, 1)
        self.inj8 = nn.Conv2d(32, 40, 1)
        self.inj16 = nn.Conv2d(48, 112, 1)
        for c in (self.inj4, self.inj8, self.inj16):
            nn.init.zeros_(c.weight); nn.init.zeros_(c.bias)
        # decoder
        self.ctx = cbr(960, dec, 1)
        self.gp = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Conv2d(960, dec, 1), nn.ReLU(inplace=True))
        self.l16 = cbr(112, dec, 1)
        self.l8 = cbr(40, dec, 1)
        self.l4 = cbr(24 + 24, dec, 1)
        self.l2 = cbr(16, 32, 1)
        self.f16 = dsconv(dec, dec)
        self.f8 = dsconv(dec, dec)
        self.f4 = dsconv(dec, dec)
        self.f2 = nn.Sequential(dsconv(dec + 32, 32), nn.Conv2d(32, 1, 1))
        self.frozen = False

    def freeze_early(self, on=True):
        """freeze stem + stages 0-1 (weights and BN statistics)"""
        self.frozen = on
        for mod in (self.stem, self.b[0], self.b[1]):
            for p in mod.parameters():
                p.requires_grad = not on

    def train(self, mode=True):
        super().train(mode)
        if self.frozen:
            for mod in (self.stem, self.b[0], self.b[1]):
                mod.eval()
        return self

    def forward(self, x):
        H, W = x.shape[-2:]
        rgb, pr = x[:, :3], x[:, 3:]
        q4 = self.p4(pr); q8 = self.p8(q4); q16 = self.p16(q8)
        if self.frozen:
            with torch.no_grad():
                s2 = self.b[0](self.stem(rgb)); s4 = self.b[1](s2)
        else:
            s2 = self.b[0](self.stem(rgb)); s4 = self.b[1](s2)
        s8 = self.b[2](s4 + self.inj4(q4))
        s16 = self.b[4](self.b[3](s8 + self.inj8(q8)))
        s32 = self.b[6](self.b[5](s16 + self.inj16(q16)))
        d = self.ctx(s32) + self.gp(s32)
        d = self.f16(F.interpolate(d, size=s16.shape[-2:], mode="bilinear", align_corners=False) + self.l16(s16))
        d = self.f8(F.interpolate(d, size=s8.shape[-2:], mode="bilinear", align_corners=False) + self.l8(s8))
        d = self.f4(F.interpolate(d, size=s4.shape[-2:], mode="bilinear", align_corners=False) + self.l4(torch.cat([s4, q4], 1)))
        d = F.interpolate(d, size=s2.shape[-2:], mode="bilinear", align_corners=False)
        d = self.f2(torch.cat([d, self.l2(s2)], 1))
        return F.interpolate(d, size=(H, W), mode="bilinear", align_corners=False)
