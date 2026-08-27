# AI Elements

AI Elements components are copied into this directory only when a feature uses them. This keeps
the initial bundle free of unused Markdown, diagram, media, and workflow dependencies while
preserving source ownership for later customization.

Use the project package runner when adding a component:

```bash
pnpm dlx ai-elements@latest add message
```

Adapt generated imports to the local `AgentItemView` model and Tauri transport. Do not introduce
`useChat` or a local HTTP transport.
