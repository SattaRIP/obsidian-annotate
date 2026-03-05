# Annotate Plugin for Obsidian

Handwrite and annotate directly in your markdown notes with realistic pens and advanced OCR.

## ✨ Features

- **Inline Handwriting**: Embed handwriting sections between paragraphs in regular notes
- **Realistic Pens**: Fountain pen, calligraphy nib (flat-edge with pressure), marker, and pencil
- **Stroke Smoothing**: Adjustable stabilization (0-10) for shaky hands
- **Dual OCR Providers**:
  - MyScript (2000 free/month, 98% accuracy - same engine as Kobo eReader)
  - Google Cloud Vision (1000 free/month)
- **Drawing Tools**: Draw, erase, pan modes with zoom support
- **Pen Controls**: Color picker, size slider, angle control for calligraphy
- **Ruled Lines**: Optional horizontal lines for writing guidance
- **Auto-save**: All strokes saved to JSON data files
- **Undo/Redo**: Full history support
- **Stylus Support**: Pressure sensitivity and twist detection for calligraphy pen rotation

## 📦 Installation

### From GitHub (Manual)

1. Download the latest release from GitHub
2. Extract the `annotate` folder to `.obsidian/plugins/` in your vault
3. Enable the plugin in Obsidian Settings → Community Plugins
4. (Optional) Configure OCR API keys in plugin settings

### From Obsidian Community Plugins

*Coming soon - currently in review*

## 🎨 Usage

### Insert Handwriting Section

1. Open any markdown note
2. Run command "Insert handwriting section" (Ctrl/Cmd+P → type "insert handwriting")
3. A canvas will appear inline in your note
4. Start drawing with your mouse, stylus, or pen tablet

### Drawing Modes

- **Draw**: Click and drag to draw strokes
- **Erase**: Click on strokes to erase them
- **Pan**: Drag to move the canvas view (or middle-click drag)

### Pen Types

- **Fountain Pen**: Smooth, pressure-sensitive ink flow
- **Calligraphy**: Flat nib with angle control and stylus twist support
- **Marker**: Broad stroke with smooth edges
- **Pencil**: Variable opacity based on pressure

### OCR (Handwriting Recognition)

1. Draw handwriting on canvas
2. Click "Extract Text (OCR)" button
3. Review and edit the recognized text in the modal
4. Click "Insert into Note" to add text at cursor position

**Setup OCR:**
- Go to Settings → Annotate
- Choose OCR provider (MyScript or Google Cloud Vision)
- Enter your API keys:
  - MyScript: Get keys at https://developer.myscript.com
  - Google Cloud: Get API key from Google Cloud Console

## ⚙️ Settings

### OCR Configuration
- **OCR Provider**: Choose between MyScript or Google Cloud Vision
- **API Keys**: Enter your MyScript (App Key + HMAC Key) or Google Cloud API key
- **Usage Tracking**: Monitor API usage with automatic counters

### Drawing Defaults
- **Default Pen Type**: Fountain, Calligraphy, Marker, or Pencil
- **Default Canvas Size**: Width x Height in pixels (default: 800x600)
- **Stroke Smoothing**: 0-10 scale for stabilizing shaky hands (default: 3)

### Storage
- **Data Folder Path**: Location for handwriting data files (default: `annotate-data`)

## 📁 Data Storage

Handwriting data is stored in separate JSON files:

```
annotate-data/
├── note-name-1234567890.json
├── note-name-1234567891.json
└── ...
```

Each file contains:
- Stroke data (points with pressure/twist, color, size, pen type)
- Canvas settings (dimensions, ruled lines)
- Pen preferences (last used pen type)

## 📝 Embed Format

The plugin uses code blocks in markdown:

```markdown
This is regular text.

```annotate
{
    "version": "1.0.0",
    "filepath": "annotate-data/note-123.json",
    "width": 800,
    "height": 600
}
```

More text continues here.
```

## 🔧 Development

### Project Structure

```
annotate/
├── manifest.json          # Plugin metadata
├── main.js                # Main plugin code (~1600 lines)
├── styles.css             # UI styling
└── README.md              # This file
```

### Building from Source

This is a vanilla JavaScript plugin - no build process required:

1. Clone the repository
2. Copy files to `.obsidian/plugins/annotate/` in your vault
3. Reload Obsidian

## 🎯 Use Cases

- **Novel Editing**: Handwrite edits on typed manuscripts, OCR back to text
- **Note Taking**: Mix typed notes with handwritten diagrams
- **Language Learning**: Practice writing in different scripts
- **Math**: Write equations by hand (OCR supports mathematical notation via MyScript)
- **Sketching**: Quick diagrams and illustrations inline with text

## 🚀 Future Enhancements

- Multi-language OCR support (Arabic, Farsi, Chinese, etc.)
- Shape recognition and smoothing
- Export as PNG/SVG
- Collaboration features

## 📜 License

MIT License - Free and open source

## 🙏 Credits

- Built for [Obsidian.md](https://obsidian.md)
- OCR powered by [MyScript](https://www.myscript.com/) and [Google Cloud Vision](https://cloud.google.com/vision)
- Canvas rendering inspired by modern digital note-taking apps

## 💬 Support

For issues and feature requests, please file an issue on GitHub.

---

**Version**: 1.0.0
**Author**: TsalMaveth
**Obsidian Min Version**: 0.15.0
