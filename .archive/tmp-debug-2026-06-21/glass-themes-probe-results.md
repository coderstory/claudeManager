# M2.16 glass-themes CDP probe report

Generated: 2026-06-20T16:09:55.102Z

Exe: ClaudeConfigManager-M2.16-glass-themes.exe

Cycle: light → glass-clear → glass-tinted (via cycleTheme button clicks).

| step | data-theme | aria-label | app-root bg | app-main bg | app-header bg |
|---|---|---|---|---|---|
| initial | light | 切换到全透玻璃主题 | rgb(250, 250, 247) | rgb(250, 250, 247) | rgba(255, 255, 255, 0.55) |
| click1 | glass-clear | 切换到半透玻璃主题 | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | rgba(255, 255, 255, 0.55) |
| click2 | glass-tinted | 切换到瓷白主题 | rgba(250, 250, 247, 0.7) | rgba(250, 250, 247, 0.7) | rgba(255, 255, 255, 0.55) |

## Expected values

- light:        app-root/app-main = `rgb(250, 250, 247)` (opaque cream, Mica covered). app-header = `rgba(255, 255, 255, 0.55)`.
- glass-clear:   app-root/app-main = `rgba(0, 0, 0, 0)` / transparent (Mica shows through). app-header = `rgba(255, 255, 255, 0.55)`.
- glass-tinted:  app-root/app-main = `rgba(250, 250, 247, 0.7)` (porcelain glass). app-header = `rgba(255, 255, 255, 0.55)`.

## Verdict

- PASS — light data-theme = light (got: ok)
- PASS — light app-root opaque cream (rgb(250, 250, 247)) (got: ok)
- PASS — glass-clear data-theme = glass-clear (got: ok)
- PASS — glass-clear app-root transparent (got: ok)
- PASS — glass-tinted data-theme = glass-tinted (got: ok)
- PASS — glass-tinted app-root rgba(250, 250, 247, 0.7) (got: ok)