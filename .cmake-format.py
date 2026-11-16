# Configuration for cmake-lint (the `cmakelang` package), used by `npm run
# cmake:lint` and by the "Workflow + CMake lint" CI job.
#
# cmake-lint's defaults are the cmake-format defaults: 2-space indents and an
# 80-column line limit, which is not the style these templates use or the style
# CMake's own modules use. Rather than disabling the two checks that complain
# (C0301 line length, C0307 indentation) — which would leave the whole lint pass
# running on codes that never fire — the settings below state the house style,
# so both checks stay enabled and still catch a genuinely long line or a
# mis-indented block.
#
# Nothing is disabled: `cmake-lint templates/*/CMakeLists.txt` exits 0 on the
# pristine templates, and a syntax error is a CRITICAL finding that exits
# non-zero regardless of this file.
with section("format"):
    # The templates indent block bodies by 4 spaces, not cmake-format's default 2.
    tab_size = 4
    # 100 columns: the long lines here are CMake commands carrying placeholder
    # paths and multi-sentence `message()` diagnostics that read worse wrapped.
    line_width = 100
