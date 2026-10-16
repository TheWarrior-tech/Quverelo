# Third-party components and data

Quvrelo bundles everything it uses offline. This file records third-party data whose
licence carries a notice that must travel with the app. (npm dependency licences are
listed in `package-lock.json`; only permissive licences — MIT/BSD/Apache/ISC/zlib — are used.)

## Hyphenation (Layout studio)

Liang hyphenation is run by the `hyphen` npm package (v1.14.1, ISC,
© Yevhen Tiurin) using its JavaScript ports of the TeX `hyph-utf8` pattern files.
Quvrelo uses the patterns unmodified (`src/core/hyphenation.ts`).

### en-GB — `hyph-en-gb.tex` (formerly `ukhyphen.tex`)

Copyright (C) 1992, 1996, 2005, 2016 Dominik Wujastyk, Graham Toal.
Licence: **MIT** (as declared in the hyph-utf8 source header,
https://github.com/hyphenation/tex-hyphen/blob/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-en-gb.tex).

> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
> THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The source file also notes the patterns were generated from a word list supplied by
Oxford University Press; the word list itself is not distributed (neither by hyph-utf8
nor by Quvrelo) and the pattern file "may be freely distributed".

### en-US — `hyph-en-us.tex` (formerly `ushyphmax.tex`, includes Knuth's `hyphen.tex` patterns)

Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken.
Licence: FSF all-permissive (source header,
https://github.com/hyphenation/tex-hyphen/blob/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-en-us.tex):

> Copying and distribution of this file, with or without modification, are permitted in
> any medium without royalty provided the copyright notice and this notice are preserved.

Neither pattern set is under the LPPL, so no rename/unmodified-distribution conditions
apply. The notices above are also kept as a legal comment in the shipped renderer bundle.
