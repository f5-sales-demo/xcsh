Displays an image inline in the terminal conversation. Shows the image visually if the terminal supports it, or opens it in the system image viewer as a fallback.

<instruction>
- Use this when you want to show an image to the user (screenshot, diagram, generated image, photo)
- Use `inspect_image` instead when you need to analyze or extract information from an image
- Provide `path` to the local image file (absolute or relative to working directory)
- Optional `caption` adds descriptive text below the image
</instruction>

<examples>
- Show a screenshot:
  - `{"path":"screenshots/dashboard.png","caption":"Current dashboard layout"}`
- Display a generated diagram:
  - `{"path":"output/architecture.png"}`
- Show a photo with context:
  - `{"path":"assets/logo.png","caption":"Current brand logo"}`
</examples>

<output>
- Returns the image as an inline image block when the terminal supports image protocols
- Falls back to opening the image in the system image viewer (Preview.app, xdg-open)
- Supports PNG, JPEG, GIF, and WEBP formats
</output>
