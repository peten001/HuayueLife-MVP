# Yunqiao MiniApp Canonical Workspace Policy

Canonical source root:

`/Users/peter/Desktop/HuayueLife-MVP`

Canonical MiniApp root:

`/Users/peter/Desktop/HuayueLife-MVP/apps/miniapp`

Canonical mp-weixin build:

`/Users/peter/Desktop/HuayueLife-MVP/apps/miniapp/dist/build/mp-weixin`

Rules:

1. Never create a MiniApp release/validation/experience worktree.
2. Never use a detached MiniApp worktree.
3. Never copy HuayueLife-MVP to create a MiniApp validation project.
4. Never build/upload MiniApp from `*-release`, `*-validation`, `*-experience`.
5. If the canonical workspace has conflicting edits in the same MiniApp files, STOP and report; do not create another worktree.
6. Unrelated dirty files must be preserved and scoped around.
7. WeChat DevTools must always open the canonical `mp-weixin` path.
8. Before any MiniApp build/upload, assert `pwd` and repo root are under canonical source root.
9. Before experience upload, delete stale canonical dist and rebuild.
10. Do not reuse a pre-existing `dist/build/mp-weixin` without rebuilding from current HEAD.
