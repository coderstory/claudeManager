# M2.16 splash CDP probe report

Generated: 2026-06-20T15:31:30.051Z

## T0 — immediate on CDP connect (pre-React or just-mount)

- present: true
- rect: x=0 y=0 w=1024 h=640
- viewport: 1024x640
- isFullscreen: true
- text: "Claude 配置管理器加载中…"
- hiddenClass: true
- opacity: 0.315615
- display: flex
- zIndex: 99999
- pointerEvents: none
- spinnerAnimation: ccm-splash-spin 0.8s
- appRootMounted: true

## T1 — after 800ms wait (post-React mount + hide timer)

- present: true
- hiddenClass: true
- opacity: 0
- display: none
- appRootMounted: true

## Verdict

- T0 (splash visible fullscreen with correct text): PASS
- T1 (splash hidden + display none after mount): PASS
