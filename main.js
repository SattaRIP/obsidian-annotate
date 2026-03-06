const { Plugin, PluginSettingTab, Setting, Notice, Menu, MarkdownRenderChild, Modal, MarkdownView } = require('obsidian');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Default settings
const DEFAULT_SETTINGS = {
	// OCR Settings
	ocrProvider: 'myscript', // 'myscript' or 'google'
	myScriptAppKey: '', // MyScript application key
	myScriptHmacKey: '', // MyScript HMAC key
	googleCloudApiKey: '', // Google Cloud Vision API key
	myScriptUsageCount: 0, // Track MyScript API usage
	googleCloudUsageCount: 0, // Track Google Cloud API usage
	usageResetDate: '', // Last reset date for usage tracking

	// Drawing Defaults
	defaultPenType: 'fountain',
	defaultPenColor: '#000000',
	defaultPenSize: 3,
	defaultCanvasWidth: 800,
	defaultCanvasHeight: 600,
	smoothingLevel: 3, // 0-10, higher = smoother strokes

	// Storage
	dataFolderPath: 'annotate-data',

	// Features
	enableTextObjects: false,
	enableComments: false,
	showRuledLines: false,

	// Canvas Appearance
	lightModeBackground: '#ffffff',
	darkModeBackground: '#000000',
	autoPenColor: true
};

class AnnotatePlugin extends Plugin {
	async onload() {
		console.log('Loading Annotate plugin');

		// Load settings
		await this.loadSettings();

		// Register markdown code block processor for 'annotate' blocks
		this.registerMarkdownCodeBlockProcessor('annotate', (source, el, ctx) => {
			try {
				const embedData = JSON.parse(source);
				ctx.addChild(new AnnotateEmbedWidget(el, this, embedData, ctx));
			} catch (error) {
				el.createEl('p', { text: 'Error parsing annotate embed: ' + error.message });
			}
		});

		// Register command: Insert handwriting section
		this.addCommand({
			id: 'insert-handwriting-section',
			name: 'Insert handwriting section',
			icon: 'pen-tool',
			editorCallback: (editor, view) => {
				this.insertNewAnnotation(editor, view);
			}
		});

		// Register command: OCR current file
		this.addCommand({
			id: 'ocr-current-file',
			name: 'OCR current file (image/PDF)',
			icon: 'scan',
			callback: async () => {
				await this.ocrCurrentFile();
			}
		});

		// Register ribbon icon
		this.addRibbonIcon('pen-tool', 'Insert handwriting section', (evt) => {
			const editor = this.app.workspace.activeEditor?.editor;
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (editor && view) {
				this.insertNewAnnotation(editor, view);
			} else {
				new Notice('Please open a note first');
			}
		});

		// Register settings tab
		this.addSettingTab(new AnnotateSettingTab(this.app, this));
	}

	async insertNewAnnotation(editor, view) {
		// Generate unique filename for this annotation
		const currentFile = view.file;
		if (!currentFile) {
			new Notice('Please save the note first');
			return;
		}

		const timestamp = Date.now();
		const baseFilename = currentFile.basename;
		const dataFilename = `${baseFilename}-${timestamp}.json`;
		const dataFolderPath = this.settings.dataFolderPath;
		const dataFilePath = `${dataFolderPath}/${dataFilename}`;

		// Ensure data folder exists
		await this.ensureDataFolder();

		// Create initial data file
		const initialData = {
			version: '1.0.0',
			canvasWidth: this.settings.defaultCanvasWidth,
			canvasHeight: this.settings.defaultCanvasHeight,
			backgroundColor: this.settings.lightModeBackground,
			strokes: [],
			textObjects: [],
			ocrCache: '',
			ocrProvider: this.settings.ocrProvider
		};

		const dataFile = await this.app.vault.create(dataFilePath, JSON.stringify(initialData, null, '\t'));

		// Build embed code block
		const embedMetadata = {
			version: '1.0.0',
			filepath: dataFilePath,
			width: this.settings.defaultCanvasWidth,
			height: this.settings.defaultCanvasHeight
		};

		const embedStr = '\n```annotate\n' + JSON.stringify(embedMetadata, null, '\t') + '\n```\n';

		// Insert at cursor
		const cursor = editor.getCursor();
		editor.replaceRange(embedStr, cursor);

		// Move cursor after embed
		const lines = embedStr.split('\n');
		const newCursor = { line: cursor.line + lines.length, ch: 0 };
		editor.setCursor(newCursor);

		new Notice('Handwriting section inserted');
	}

	async ensureDataFolder() {
		const folderPath = this.settings.dataFolderPath;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!folder) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	async ocrCurrentFile() {
		try {
			// Get current file (works for PDFs, images, and markdown files)
			const currentFile = this.app.workspace.getActiveFile();
			if (!currentFile) {
				new Notice('No file is currently open');
				return;
			}

			const extension = currentFile.extension.toLowerCase();

			// Check if it's a supported file type
			if (!['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(extension)) {
				new Notice('Current file must be a PDF or image file');
				return;
			}

			// Image/PDF OCR requires Google Cloud Vision (MyScript only works with strokes)
			if (!this.settings.googleCloudApiKey) {
				new Notice('Google Cloud API key required for image/PDF OCR. Configure it in Settings > Annotate.');
				return;
			}

			new Notice(`OCRing ${currentFile.name}...`);

			// Get full file path
			const filePath = this.app.vault.adapter.getFullPath(currentFile.path);

			let imagePaths = [];

			// If PDF, convert to images first
			if (extension === 'pdf') {
				const tempDir = require('os').tmpdir();
				const tempPrefix = path.join(tempDir, `ocr-${Date.now()}`);

				// Convert PDF to PNG images
				await execAsync(`pdftoppm -png "${filePath}" "${tempPrefix}"`);

				// Find generated images
				const files = await fs.readdir(tempDir);
				imagePaths = files
					.filter(f => f.startsWith(path.basename(tempPrefix)) && f.endsWith('.png'))
					.map(f => path.join(tempDir, f))
					.sort();

				if (imagePaths.length === 0) {
					new Notice('Failed to convert PDF to images');
					return;
				}
			} else {
				// Single image file
				imagePaths = [filePath];
			}

			// OCR all images
			let allText = '';
			for (let i = 0; i < imagePaths.length; i++) {
				const imgPath = imagePaths[i];
				new Notice(`Processing page ${i + 1} of ${imagePaths.length}...`);

				// Always use Google Cloud Vision for image/PDF OCR
				const pageText = await this.ocrImageWithGoogle(imgPath);

				if (pageText) {
					if (imagePaths.length > 1) {
						allText += `\n## Page ${i + 1}\n\n${pageText}\n`;
					} else {
						allText += pageText;
					}
				}
			}

			// Clean up temp files for PDFs
			if (extension === 'pdf') {
				for (const imgPath of imagePaths) {
					await fs.unlink(imgPath).catch(() => {});
				}
			}

			if (!allText.trim()) {
				new Notice('No text could be extracted');
				return;
			}

			// Show results in modal
			new ExtractedTextModal(this.app, allText.trim(), (finalText) => {
				// Try to get active markdown editor to insert text
				const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeMarkdownView && activeMarkdownView.editor) {
					const editor = activeMarkdownView.editor;
					const cursor = editor.getCursor();
					editor.replaceRange('\n' + finalText + '\n', cursor);
					new Notice('OCR text inserted');
				} else {
					// If no markdown editor is open, just copy to clipboard
					navigator.clipboard.writeText(finalText);
					new Notice('OCR text copied to clipboard (no markdown editor open)');
				}
			}).open();

		} catch (error) {
			console.error('OCR Current File Error:', error);
			new Notice(`OCR failed: ${error.message}`);
		}
	}

	async ocrImageWithGoogle(imagePath) {
		const settings = this.settings;

		try {
			// Read image and convert to base64
			const imageBuffer = await fs.readFile(imagePath);
			const imageBase64 = imageBuffer.toString('base64');

			// Call Google Cloud Vision API
			const apiKey = settings.googleCloudApiKey;
			const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

			const requestBody = {
				requests: [{
					image: {
						content: imageBase64
					},
					features: [{
						type: 'DOCUMENT_TEXT_DETECTION',
						maxResults: 1
					}]
				}]
			};

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Google Cloud API error: ${response.status} - ${errorText}`);
			}

			// Increment usage counter
			settings.googleCloudUsageCount++;
			await this.saveSettings();

			const result = await response.json();

			// Extract text from response
			let extractedText = '';
			if (result.responses && result.responses[0]) {
				const textAnnotations = result.responses[0].textAnnotations;
				if (textAnnotations && textAnnotations.length > 0) {
					extractedText = textAnnotations[0].description;
				}
			}

			return extractedText;

		} catch (error) {
			console.error('Google Cloud Vision Error:', error);
			throw error;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
		console.log('Unloading Annotate plugin');
	}
}

// ==================== EMBED WIDGET ====================

class AnnotateEmbedWidget extends MarkdownRenderChild {
	constructor(containerEl, plugin, embedData, ctx) {
		super(containerEl);
		this.containerEl = containerEl;
		this.plugin = plugin;
		this.embedData = embedData;
		this.ctx = ctx;
		this.canvasData = null;

		// Canvas state
		this.canvas = null;
		this.ctx2d = null;
		this.drawing = false;
		this.currentStroke = null;
		this.strokes = [];
		this.history = [];
		this.historyIndex = -1;

		// Transform state (pan/zoom)
		this.offsetX = 0;
		this.offsetY = 0;
		this.scale = 1;

		// Drawing mode
		this.mode = 'draw'; // 'draw', 'erase', 'pan'
		this.penType = plugin.settings.defaultPenType;
		this.penColor = plugin.settings.defaultPenColor;
		this.penSize = plugin.settings.defaultPenSize;

		// Dark mode state
		this.isDarkMode = this.detectDarkMode(); // Auto-detect Obsidian theme
		this.canvasDarkMode = null; // null = auto, true = dark, false = light
		this.autoPenColor = true; // Auto-switch pen color with theme

		// Ruled lines state (load from saved data or default to true)
		this.showLines = true; // Toggle for ruled lines (default ON)
		this.lineHeight = 30; // Height of each line (writing space)
		this.lineGap = 10; // Gap between lines

		// Calligraphy pen angle (in degrees)
		this.calligraphyAngle = 45;

		// Clipboard for copy/paste
		this.clipboard = [];
	}

	detectDarkMode() {
		// Check if Obsidian is in dark mode
		return document.body.classList.contains('theme-dark');
	}

	getEffectiveDarkMode() {
		// Return manual override if set, otherwise auto-detect
		if (this.canvasDarkMode !== null) {
			return this.canvasDarkMode;
		}
		return this.detectDarkMode();
	}

	applyCanvasTheme(darkModeBtn = null) {
		// Apply dark/light theme to canvas background
		const isDark = this.getEffectiveDarkMode();
		this.isDarkMode = isDark;

		// Update canvas background color (only if canvasData is loaded)
		if (this.canvasData) {
			this.canvasData.backgroundColor = isDark ? '#000000' : '#ffffff';
		}

		// Update pen color if auto pen color is enabled
		if (this.autoPenColor) {
			this.penColor = isDark ? '#FFFFFF' : '#000000';
			// Update color picker if it exists
			if (this.colorInput) {
				this.colorInput.value = this.penColor;
			}
		}

		// Update button styling to match canvas
		if (darkModeBtn) {
			darkModeBtn.style.backgroundColor = isDark ? '#000000' : '#ffffff';
			darkModeBtn.style.color = isDark ? '#ffffff' : '#000000';
			darkModeBtn.style.borderColor = isDark ? '#444444' : '#cccccc';
		}

		// Re-render canvas with new background
		this.render();
		this.drawRuledLines();
	}

	async onload() {
		// Load canvas data from file
		const filepath = this.embedData.filepath;
		const file = this.plugin.app.vault.getAbstractFileByPath(filepath);

		if (!file) {
			this.containerEl.createEl('p', {
				text: 'Annotation data file not found: ' + filepath
			});
			return;
		}

		const dataStr = await this.plugin.app.vault.read(file);
		this.canvasData = JSON.parse(dataStr);
		this.strokes = this.canvasData.strokes || [];

		// Load line state from saved data (or keep default true)
		if (this.canvasData.showLines !== undefined) {
			this.showLines = this.canvasData.showLines;
		}

		// Load pen type from saved data
		if (this.canvasData.penType) {
			this.penType = this.canvasData.penType;
		}

		// Create UI
		this.createUI();
	}

	createUI() {
		// Container
		const container = this.containerEl.createDiv({ cls: 'annotate-container' });

		// Toolbar
		const toolbar = container.createDiv({ cls: 'annotate-toolbar' });
		this.createToolbar(toolbar);

		// Canvas wrapper
		this.canvasWrapper = container.createDiv({ cls: 'annotate-canvas-wrapper' });

		// Create a container for both canvases
		const canvasContainer = this.canvasWrapper.createDiv({ cls: 'annotate-canvas-container' });
		canvasContainer.style.position = 'relative';
		canvasContainer.style.display = 'inline-block';

		// Set initial size of container
		const initialWidth = this.embedData.width || this.plugin.settings.defaultCanvasWidth;
		const initialHeight = this.embedData.height || this.plugin.settings.defaultCanvasHeight;
		canvasContainer.style.width = `${initialWidth}px`;
		canvasContainer.style.height = `${initialHeight}px`;

		// Create lines canvas (background layer for ruled lines)
		this.linesCanvas = canvasContainer.createEl('canvas', { cls: 'annotate-lines-canvas' });
		this.linesCanvas.width = initialWidth;
		this.linesCanvas.height = initialHeight;
		this.linesCtx = this.linesCanvas.getContext('2d');

		// Create content canvas (foreground layer for drawing)
		this.canvas = canvasContainer.createEl('canvas', { cls: 'annotate-content-canvas' });
		this.canvas.width = this.embedData.width || this.plugin.settings.defaultCanvasWidth;
		this.canvas.height = this.embedData.height || this.plugin.settings.defaultCanvasHeight;
		this.ctx2d = this.canvas.getContext('2d');

		// Set up event listeners
		this.setupCanvasEvents();

		// Add resize handles
		this.setupResizeHandles(canvasContainer, this.canvasWrapper);

		// Set up keyboard shortcuts
		this.setupKeyboardShortcuts();

		// Initial render
		this.render();
		this.drawRuledLines();
	}

	createToolbar(toolbar) {
		// Mode buttons
		const drawBtn = toolbar.createEl('button', { text: 'Draw', cls: 'annotate-btn' });
		drawBtn.classList.add('active');
		drawBtn.addEventListener('click', () => {
			this.mode = 'draw';
			this.updateToolbarState();
		});

		const eraseBtn = toolbar.createEl('button', { text: 'Erase', cls: 'annotate-btn' });
		eraseBtn.addEventListener('click', () => {
			this.mode = 'erase';
			this.updateToolbarState();
		});

		const panBtn = toolbar.createEl('button', { text: 'Pan', cls: 'annotate-btn' });
		panBtn.addEventListener('click', () => {
			this.mode = 'pan';
			this.updateToolbarState();
		});

		// Separator
		toolbar.createEl('span', { text: '|', cls: 'annotate-separator' });

		// Pen type selector
		const penLabel = toolbar.createEl('span', { text: 'Pen:', cls: 'annotate-label' });
		const penSelect = toolbar.createEl('select', { cls: 'annotate-select' });
		['fountain', 'calligraphy', 'marker', 'pencil'].forEach(type => {
			const option = penSelect.createEl('option', { text: type, value: type });
			if (type === this.penType) option.selected = true;
		});

		// Calligraphy angle control (only shown when calligraphy pen is selected)
		const angleLabel = toolbar.createEl('span', { text: 'Angle:', cls: 'annotate-label' });
		const angleInput = toolbar.createEl('input', {
			type: 'range',
			min: '0',
			max: '90',
			value: String(this.calligraphyAngle),
			cls: 'annotate-size-input'
		});
		const angleValue = toolbar.createEl('span', { text: `${this.calligraphyAngle}°`, cls: 'annotate-size-value' });
		angleInput.addEventListener('input', (e) => {
			this.calligraphyAngle = Number(e.target.value);
			angleValue.textContent = `${this.calligraphyAngle}°`;
		});

		// Show/hide angle control based on pen type
		const updateAngleVisibility = () => {
			const showAngle = this.penType === 'calligraphy';
			angleLabel.style.display = showAngle ? '' : 'none';
			angleInput.style.display = showAngle ? '' : 'none';
			angleValue.style.display = showAngle ? '' : 'none';
		};

		penSelect.addEventListener('change', (e) => {
			this.penType = e.target.value;
			updateAngleVisibility();
			this.saveData(); // Save pen type preference
		});

		updateAngleVisibility(); // Initial visibility

		// Color picker
		const colorLabel = toolbar.createEl('span', { text: 'Color:', cls: 'annotate-label' });
		this.colorInput = toolbar.createEl('input', {
			type: 'color',
			value: this.penColor,
			cls: 'annotate-color-input'
		});
		this.colorInput.addEventListener('change', (e) => {
			this.penColor = e.target.value;
			this.autoPenColor = false; // Disable auto color when manually changed
		});

		// Size slider
		const sizeLabel = toolbar.createEl('span', { text: 'Size:', cls: 'annotate-label' });
		const sizeInput = toolbar.createEl('input', {
			type: 'range',
			min: '1',
			max: '20',
			value: String(this.penSize),
			cls: 'annotate-size-input'
		});
		const sizeValue = toolbar.createEl('span', { text: String(this.penSize), cls: 'annotate-size-value' });
		sizeInput.addEventListener('input', (e) => {
			this.penSize = Number(e.target.value);
			sizeValue.textContent = String(this.penSize);
		});

		// Separator
		toolbar.createEl('span', { text: '|', cls: 'annotate-separator' });

		// Undo/Redo
		const undoBtn = toolbar.createEl('button', { text: 'Undo', cls: 'annotate-btn' });
		undoBtn.addEventListener('click', () => this.undo());

		const redoBtn = toolbar.createEl('button', { text: 'Redo', cls: 'annotate-btn' });
		redoBtn.addEventListener('click', () => this.redo());

		// Clear
		const clearBtn = toolbar.createEl('button', { text: 'Clear', cls: 'annotate-btn' });
		clearBtn.addEventListener('click', () => this.clearCanvas());

		// Separator
		toolbar.createEl('span', { text: '|', cls: 'annotate-separator' });

		// Ruled lines toggle
		const linesBtn = toolbar.createEl('button', { text: 'Lines', cls: 'annotate-btn' });
		if (this.showLines) linesBtn.classList.add('active');
		linesBtn.addEventListener('click', () => {
			this.showLines = !this.showLines;
			linesBtn.classList.toggle('active', this.showLines);
			this.drawRuledLines();
			this.saveData(); // Persist line state
		});

		// Separator
		toolbar.createEl('span', { text: '|', cls: 'annotate-separator' });

		// OCR button
		const ocrBtn = toolbar.createEl('button', { text: 'Extract Text (OCR)', cls: 'annotate-btn annotate-ocr-btn' });
		ocrBtn.addEventListener('click', () => this.extractText());

		// Separator
		toolbar.createEl('span', { text: '|', cls: 'annotate-separator' });

		// Light/Dark mode toggle
		const darkModeBtn = toolbar.createEl('button', {
			text: this.getEffectiveDarkMode() ? 'Dark' : 'Light',
			cls: 'annotate-btn annotate-dark-mode-btn'
		});
		darkModeBtn.addEventListener('click', () => {
			if (this.canvasDarkMode === null) {
				// First click: set opposite of current auto-detected mode
				this.canvasDarkMode = !this.detectDarkMode();
			} else if (this.canvasDarkMode === true) {
				// Second click: set to light
				this.canvasDarkMode = false;
			} else if (this.canvasDarkMode === false) {
				// Third click: back to auto
				this.canvasDarkMode = null;
			}

			const effectiveMode = this.getEffectiveDarkMode();
			darkModeBtn.setText(effectiveMode ? 'Dark' : 'Light');
			this.applyCanvasTheme(darkModeBtn);

			const modeText = this.canvasDarkMode === null
				? 'Auto (following Obsidian theme)'
				: (this.canvasDarkMode ? 'Dark (manual)' : 'Light (manual)');
			new Notice(`Canvas mode: ${modeText}`);
		});

		// Auto pen color checkbox
		const autoPenColorContainer = toolbar.createDiv({ cls: 'annotate-auto-pen-color' });
		const autoPenColorCheckbox = autoPenColorContainer.createEl('input', {
			type: 'checkbox',
			cls: 'annotate-checkbox'
		});
		autoPenColorCheckbox.checked = this.autoPenColor;
		autoPenColorContainer.createEl('span', { text: ' Auto pen color', cls: 'annotate-label' });
		autoPenColorCheckbox.addEventListener('change', (e) => {
			this.autoPenColor = e.target.checked;
			if (this.autoPenColor) {
				// Apply current theme's pen color
				this.applyCanvasTheme(darkModeBtn);
				new Notice('Pen color will auto-switch with theme');
			} else {
				new Notice('Pen color set to manual');
			}
		});

		// Apply initial theme styling
		this.applyCanvasTheme(darkModeBtn);

		// Separator
		toolbar.createEl('span', { text: '|', cls: 'annotate-separator' });

		// Canvas size controls
		const sizeControlsLabel = toolbar.createEl('span', { text: 'Canvas:', cls: 'annotate-label' });

		// Get initial dimensions (canvas doesn't exist yet during toolbar creation)
		const initialWidth = this.embedData.width || this.plugin.settings.defaultCanvasWidth;
		const initialHeight = this.embedData.height || this.plugin.settings.defaultCanvasHeight;

		// Width input
		const widthInput = toolbar.createEl('input', {
			type: 'number',
			value: String(initialWidth),
			cls: 'annotate-dimension-input',
			attr: { min: '400', max: '5000', step: '100' }
		});
		widthInput.placeholder = 'Width';
		widthInput.addEventListener('change', (e) => {
			const newWidth = Number(e.target.value) || 1600;
			const currentHeight = this.canvas ? this.canvas.height : initialHeight;
			this.resizeCanvas(newWidth, currentHeight, true);
			widthInput.value = String(newWidth);
		});

		toolbar.createEl('span', { text: 'x', cls: 'annotate-label' });

		// Height input
		const heightInput = toolbar.createEl('input', {
			type: 'number',
			value: String(initialHeight),
			cls: 'annotate-dimension-input',
			attr: { min: '300', max: '5000', step: '100' }
		});
		heightInput.placeholder = 'Height';
		heightInput.addEventListener('change', (e) => {
			const newHeight = Number(e.target.value) || 800;
			const currentWidth = this.canvas ? this.canvas.width : initialWidth;
			this.resizeCanvas(currentWidth, newHeight, true);
			heightInput.value = String(newHeight);
		});

		// Store input references to update them when canvas is resized
		this.widthInput = widthInput;
		this.heightInput = heightInput;

		// Store toolbar buttons for state updates
		this.toolbarButtons = { drawBtn, eraseBtn, panBtn };
	}

	resizeCanvas(newWidth, newHeight, showNotice = false) {
		// Update both canvases
		this.canvas.width = newWidth;
		this.canvas.height = newHeight;
		this.linesCanvas.width = newWidth;
		this.linesCanvas.height = newHeight;

		// Update embed data
		this.embedData.width = newWidth;
		this.embedData.height = newHeight;

		// Update input fields if they exist
		if (this.widthInput) {
			this.widthInput.value = String(newWidth);
		}
		if (this.heightInput) {
			this.heightInput.value = String(newHeight);
		}

		// Re-render everything
		this.render();
		this.drawRuledLines();

		// Save updated dimensions
		this.saveData();

		if (showNotice) {
			new Notice(`Canvas resized to ${newWidth}x${newHeight}`);
		}
	}

	updateToolbarState() {
		Object.values(this.toolbarButtons).forEach(btn => btn.classList.remove('active'));
		if (this.mode === 'draw') this.toolbarButtons.drawBtn.classList.add('active');
		if (this.mode === 'erase') this.toolbarButtons.eraseBtn.classList.add('active');
		if (this.mode === 'pan') this.toolbarButtons.panBtn.classList.add('active');
	}

	setupCanvasEvents() {
		let lastX = 0, lastY = 0;
		let isPanning = false;
		let middleClickPanning = false;

		this.canvas.addEventListener('pointerdown', (e) => {
			const rect = this.canvas.getBoundingClientRect();
			const screenX = e.clientX - rect.left;
			const screenY = e.clientY - rect.top;
			const pressure = e.pressure || 0.5;
			const twist = e.twist || 0; // Stylus rotation in degrees

			// Right click - do nothing
			if (e.button === 2) {
				e.preventDefault();
				return;
			}

			// Middle click - always pan regardless of mode
			if (e.button === 1) {
				e.preventDefault();
				middleClickPanning = true;
				isPanning = true;
				lastX = screenX;
				lastY = screenY;
				return;
			}

			// Left click only (button 0)
			if (e.button === 0) {
				if (this.mode === 'draw') {
					const canvasCoords = this.screenToCanvasCoords(screenX, screenY);
					this.startStroke(canvasCoords.x, canvasCoords.y, pressure, twist);
				} else if (this.mode === 'erase') {
					const canvasCoords = this.screenToCanvasCoords(screenX, screenY);
					this.eraseAtPoint(canvasCoords.x, canvasCoords.y);
				} else if (this.mode === 'pan') {
					isPanning = true;
					lastX = screenX;
					lastY = screenY;
				}
			}
		});

		this.canvas.addEventListener('pointermove', (e) => {
			const rect = this.canvas.getBoundingClientRect();
			const screenX = e.clientX - rect.left;
			const screenY = e.clientY - rect.top;
			const pressure = e.pressure || 0.5;
			const twist = e.twist || 0;

			// Handle middle click panning
			if (middleClickPanning && isPanning) {
				const dx = screenX - lastX;
				const dy = screenY - lastY;
				this.offsetX += dx;
				this.offsetY += dy;
				lastX = screenX;
				lastY = screenY;
				this.render();
				return;
			}

			// Left button (buttons & 1 checks if left button is pressed)
			if (this.mode === 'draw' && this.drawing && (e.buttons & 1)) {
				const canvasCoords = this.screenToCanvasCoords(screenX, screenY);
				this.addPointToStroke(canvasCoords.x, canvasCoords.y, pressure, twist);
			} else if (this.mode === 'erase' && (e.buttons & 1)) {
				const canvasCoords = this.screenToCanvasCoords(screenX, screenY);
				this.eraseAtPoint(canvasCoords.x, canvasCoords.y);
			} else if (this.mode === 'pan' && isPanning) {
				const dx = screenX - lastX;
				const dy = screenY - lastY;
				this.offsetX += dx;
				this.offsetY += dy;
				lastX = screenX;
				lastY = screenY;
				this.render();
			}
		});

		this.canvas.addEventListener('pointerup', (e) => {
			if (this.mode === 'draw' && this.drawing) {
				this.endStroke();
			}
			if (e.button === 1) {
				middleClickPanning = false;
			}
			if (this.mode === 'pan' || middleClickPanning) {
				isPanning = false;
			}
		});

		this.canvas.addEventListener('pointerleave', (e) => {
			if (this.drawing) {
				this.endStroke();
			}
			isPanning = false;
			middleClickPanning = false;
		});

		// Allow context menu on right click
		// (removed preventDefault to allow default context menu)
	}

	setupResizeHandles(container, wrapper) {
		const handles = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
		const handleElements = {};

		handles.forEach(position => {
			const handle = container.createDiv({ cls: `resize-handle ${position}` });
			handleElements[position] = handle;

			handle.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();

				const startX = e.clientX;
				const startY = e.clientY;
				const startWidth = this.canvas.width;
				const startHeight = this.canvas.height;

				const onMouseMove = (e) => {
					const dx = e.clientX - startX;
					const dy = e.clientY - startY;

					let newWidth = startWidth;
					let newHeight = startHeight;

					// Update width based on horizontal direction
					if (position.includes('e')) {
						newWidth = Math.max(400, startWidth + dx);
					} else if (position.includes('w')) {
						newWidth = Math.max(400, startWidth - dx);
					}

					// Update height based on vertical direction
					if (position.includes('s')) {
						newHeight = Math.max(300, startHeight + dy);
					} else if (position.includes('n')) {
						newHeight = Math.max(300, startHeight - dy);
					}

					// Update container and canvas size
					container.style.width = `${newWidth}px`;
					container.style.height = `${newHeight}px`;
					this.resizeCanvas(newWidth, newHeight);
					updateHandlePositions();
				};

				const onMouseUp = () => {
					document.removeEventListener('mousemove', onMouseMove);
					document.removeEventListener('mouseup', onMouseUp);
				};

				document.addEventListener('mousemove', onMouseMove);
				document.addEventListener('mouseup', onMouseUp);
			});
		});

		// Update handle positions based on scroll
		const updateHandlePositions = () => {
			const scrollLeft = wrapper.scrollLeft;
			const scrollTop = wrapper.scrollTop;
			const wrapperRect = wrapper.getBoundingClientRect();
			const wrapperWidth = wrapperRect.width;
			const wrapperHeight = wrapperRect.height;
			const containerWidth = container.offsetWidth;
			const containerHeight = container.offsetHeight;

			// Calculate visible viewport boundaries relative to container
			const visibleLeft = scrollLeft;
			const visibleRight = scrollLeft + wrapperWidth;
			const visibleTop = scrollTop;
			const visibleBottom = scrollTop + wrapperHeight;

			// Right-side handles - position at right edge of visible area, or container edge if visible
			const rightPos = Math.min(containerWidth - 12, visibleRight - 20);
			if (handleElements.e) {
				handleElements.e.style.left = `${rightPos}px`;
			}
			if (handleElements.ne) {
				handleElements.ne.style.left = `${rightPos}px`;
			}
			if (handleElements.se) {
				handleElements.se.style.left = `${rightPos}px`;
			}

			// Left-side handles - position at left edge of visible area, or container edge if visible
			const leftPos = Math.max(0, visibleLeft);
			if (handleElements.w) {
				handleElements.w.style.left = `${leftPos}px`;
			}
			if (handleElements.nw) {
				handleElements.nw.style.left = `${leftPos}px`;
			}
			if (handleElements.sw) {
				handleElements.sw.style.left = `${leftPos}px`;
			}

			// Bottom-side handles - position at bottom edge of visible area, or container edge if visible
			const bottomPos = Math.min(containerHeight - 12, visibleBottom - 20);
			if (handleElements.s) {
				handleElements.s.style.top = `${bottomPos}px`;
			}
			if (handleElements.sw) {
				handleElements.sw.style.top = `${bottomPos}px`;
			}
			if (handleElements.se) {
				handleElements.se.style.top = `${bottomPos}px`;
			}

			// Top-side handles - position at top edge of visible area, or container edge if visible
			const topPos = Math.max(0, visibleTop);
			if (handleElements.n) {
				handleElements.n.style.top = `${topPos}px`;
			}
			if (handleElements.nw) {
				handleElements.nw.style.top = `${topPos}px`;
			}
			if (handleElements.ne) {
				handleElements.ne.style.top = `${topPos}px`;
			}
		};

		// Listen for scroll events
		wrapper.addEventListener('scroll', updateHandlePositions);
		this.handlePositionUpdater = updateHandlePositions;

		// Also update on wrapper resize
		const wrapperResizeObserver = new ResizeObserver(() => {
			updateHandlePositions();
		});
		wrapperResizeObserver.observe(wrapper);
		this.wrapperResizeObserver = wrapperResizeObserver;

		// Initial position
		updateHandlePositions();
	}

	setupKeyboardShortcuts() {
		this.keydownHandler = (e) => {
			// Only handle shortcuts when canvas is focused or being used
			const isCtrl = e.ctrlKey || e.metaKey;

			if (isCtrl && e.key === 'z') {
				e.preventDefault();
				this.undo();
			} else if (isCtrl && e.key === 'y') {
				e.preventDefault();
				this.redo();
			} else if (isCtrl && e.key === 'c') {
				e.preventDefault();
				this.copyStrokes();
			} else if (isCtrl && e.key === 'x') {
				e.preventDefault();
				this.cutStrokes();
			} else if (isCtrl && e.key === 'v') {
				e.preventDefault();
				this.pasteStrokes();
			}
		};

		// Add keyboard event listener to the canvas container
		this.containerEl.addEventListener('keydown', this.keydownHandler);
	}

	copyStrokes() {
		if (this.strokes.length === 0) {
			new Notice('No strokes to copy');
			return;
		}
		// Copy all strokes to clipboard (as JSON)
		this.clipboard = JSON.parse(JSON.stringify(this.strokes));
		new Notice(`Copied ${this.strokes.length} stroke(s)`);
	}

	cutStrokes() {
		if (this.strokes.length === 0) {
			new Notice('No strokes to cut');
			return;
		}
		// Copy to clipboard and clear canvas
		this.clipboard = JSON.parse(JSON.stringify(this.strokes));
		const count = this.strokes.length;
		this.strokes = [];
		this.addToHistory();
		this.render();
		this.saveData();
		new Notice(`Cut ${count} stroke(s)`);
	}

	pasteStrokes() {
		if (!this.clipboard || this.clipboard.length === 0) {
			new Notice('Nothing to paste');
			return;
		}
		// Paste strokes from clipboard
		this.strokes.push(...JSON.parse(JSON.stringify(this.clipboard)));
		this.addToHistory();
		this.render();
		this.saveData();
		new Notice(`Pasted ${this.clipboard.length} stroke(s)`);
	}

	// CRITICAL: Convert screen coordinates to canvas coordinates
	// This prevents coordinate offset bugs when pan/zoom is applied
	screenToCanvasCoords(screenX, screenY) {
		return {
			x: (screenX - this.offsetX) / this.scale,
			y: (screenY - this.offsetY) / this.scale
		};
	}

	startStroke(x, y, pressure = 0.5, twist = 0) {
		this.drawing = true;
		this.currentStroke = {
			id: `stroke-${Date.now()}`,
			points: [[x, y, pressure, twist]],
			color: this.penColor,
			size: this.penSize,
			penType: this.penType,
			timestamp: Date.now()
		};
	}

	addPointToStroke(x, y, pressure = 0.5, twist = 0) {
		if (!this.currentStroke) return;

		// Apply smoothing based on smoothing level (0-10)
		const smoothingLevel = this.plugin.settings.smoothingLevel || 0;

		if (smoothingLevel > 0 && this.currentStroke.points.length > 0) {
			// Calculate how many previous points to average with
			// Level 0: no smoothing
			// Level 1-3: average with 1-2 points
			// Level 4-7: average with 3-4 points
			// Level 8-10: average with 5-6 points
			const windowSize = Math.min(
				Math.floor(smoothingLevel / 2) + 1,
				this.currentStroke.points.length
			);

			// Get the last N points
			const recentPoints = this.currentStroke.points.slice(-windowSize);

			// Calculate weighted average (newer points have more weight)
			let totalWeight = 0;
			let avgX = 0;
			let avgY = 0;
			let avgPressure = 0;
			let avgTwist = 0;

			for (let i = 0; i < recentPoints.length; i++) {
				const weight = i + 1; // Newer points get more weight
				totalWeight += weight;
				avgX += recentPoints[i][0] * weight;
				avgY += recentPoints[i][1] * weight;
				avgPressure += recentPoints[i][2] * weight;
				avgTwist += recentPoints[i][3] * weight;
			}

			// Include the new point with highest weight
			const newPointWeight = windowSize + 1;
			totalWeight += newPointWeight;
			avgX += x * newPointWeight;
			avgY += y * newPointWeight;
			avgPressure += pressure * newPointWeight;
			avgTwist += twist * newPointWeight;

			// Normalize
			x = avgX / totalWeight;
			y = avgY / totalWeight;
			pressure = avgPressure / totalWeight;
			twist = avgTwist / totalWeight;
		}

		this.currentStroke.points.push([x, y, pressure, twist]);
		this.render();
	}

	endStroke() {
		if (!this.currentStroke) return;

		this.strokes.push(this.currentStroke);
		this.saveState();
		this.currentStroke = null;
		this.drawing = false;
		this.saveData();
	}

	eraseAtPoint(x, y) {
		const eraseRadius = 20;
		this.strokes = this.strokes.filter(stroke => {
			return !stroke.points.some(point => {
				const dx = point[0] - x;
				const dy = point[1] - y;
				return Math.sqrt(dx * dx + dy * dy) < eraseRadius;
			});
		});
		this.saveState();
		this.render();
		this.saveData();
	}

	clearCanvas() {
		if (this.strokes.length === 0) return;

		if (confirm('Clear all strokes?')) {
			this.strokes = [];
			this.saveState();
			this.render();
			this.saveData();
		}
	}

	saveState() {
		// Trim history if we're not at the end
		if (this.historyIndex < this.history.length - 1) {
			this.history = this.history.slice(0, this.historyIndex + 1);
		}

		// Save current state
		this.history.push(JSON.parse(JSON.stringify(this.strokes)));
		this.historyIndex++;

		// Limit history size
		if (this.history.length > 50) {
			this.history.shift();
			this.historyIndex--;
		}
	}

	undo() {
		if (this.historyIndex > 0) {
			this.historyIndex--;
			this.strokes = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
			this.render();
			this.saveData();
		}
	}

	redo() {
		if (this.historyIndex < this.history.length - 1) {
			this.historyIndex++;
			this.strokes = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
			this.render();
			this.saveData();
		}
	}

	render() {
		if (!this.ctx2d || !this.canvasData) return;

		const ctx = this.ctx2d;

		// Clear canvas (make it transparent so lines canvas shows through)
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		// Apply transform
		ctx.save();
		ctx.translate(this.offsetX, this.offsetY);
		ctx.scale(this.scale, this.scale);

		// Draw all strokes
		this.strokes.forEach(stroke => {
			this.drawStroke(ctx, stroke);
		});

		// Draw current stroke
		if (this.currentStroke) {
			this.drawStroke(ctx, this.currentStroke);
		}

		ctx.restore();
	}

	drawStroke(ctx, stroke) {
		if (stroke.points.length < 1) return;

		const penType = stroke.penType || 'fountain';

		switch (penType) {
			case 'fountain':
				this.drawFountainPen(ctx, stroke);
				break;
			case 'calligraphy':
				this.drawCalligraphyPen(ctx, stroke);
				break;
			case 'marker':
				this.drawMarker(ctx, stroke);
				break;
			case 'pencil':
				this.drawPencil(ctx, stroke);
				break;
			default:
				this.drawFountainPen(ctx, stroke);
		}
	}

	drawFountainPen(ctx, stroke) {
		if (stroke.points.length < 1) return;

		ctx.strokeStyle = stroke.color;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		// Draw each segment with pressure-varying width
		for (let i = 0; i < stroke.points.length - 1; i++) {
			const [x1, y1, p1 = 0.5, twist1] = stroke.points[i];
			const [x2, y2, p2 = 0.5, twist2] = stroke.points[i + 1];

			// Calculate width based on pressure (0.5x to 1.5x base size)
			const width1 = stroke.size * (0.5 + p1);
			const width2 = stroke.size * (0.5 + p2);
			const avgWidth = (width1 + width2) / 2;

			ctx.lineWidth = avgWidth;
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
		}
	}

	drawCalligraphyPen(ctx, stroke) {
		if (stroke.points.length < 1) return;

		const baseNibWidth = stroke.size * 3;
		ctx.fillStyle = stroke.color;

		// Calculate total stroke length to detect dots
		let totalLength = 0;
		for (let i = 1; i < stroke.points.length; i++) {
			const [x, y] = stroke.points[i];
			const [prevX, prevY] = stroke.points[i - 1];
			const dx = x - prevX;
			const dy = y - prevY;
			totalLength += Math.sqrt(dx * dx + dy * dy);
		}

		// If stroke is very short (dot), use full width for all points
		const isDot = totalLength < 10;

		// Draw overlapping filled rectangles with interpolation between points
		for (let i = 0; i < stroke.points.length; i++) {
			const [x, y, pressure = 0.5, twist = 0] = stroke.points[i];

			// Use stylus twist if available, otherwise use fixed calligraphy angle
			const nibAngleRad = twist !== 0 ? (twist * Math.PI) / 180 : ((this.calligraphyAngle || 45) * Math.PI) / 180;

			// Calculate stroke direction for width variation
			let widthFactor = 1.0; // Default to full width

			if (!isDot && i > 0) {
				const [prevX, prevY] = stroke.points[i - 1];
				const dx = x - prevX;
				const dy = y - prevY;
				const distance = Math.sqrt(dx * dx + dy * dy);

				// Only calculate angle-based width if there's significant movement
				if (distance > 1) {
					const strokeAngle = Math.atan2(dy, dx);
					const angleDiff = Math.abs(strokeAngle - nibAngleRad);
					widthFactor = Math.abs(Math.sin(angleDiff));
					// Ensure minimum width factor to avoid too-thin strokes
					widthFactor = Math.max(0.3, widthFactor);
				}
			}

			// Nib width based on pressure
			const nibWidth = baseNibWidth * (0.7 + pressure * 0.3);
			const nibLength = nibWidth * (0.3 + widthFactor * 0.7);

			// Asymmetric nib height: thin rectangle (nib thickness)
			const nibHeight = nibWidth * 0.08;  // Very thin rectangle

			// Opacity based on pressure (light touch = translucent, heavy = opaque)
			const opacity = 0.3 + pressure * 0.7;

			// Draw rotated rectangle centered at point (perpendicular to nib angle)
			ctx.save();
			ctx.globalAlpha = opacity;
			ctx.translate(x, y);
			ctx.rotate(nibAngleRad + Math.PI / 2);
			ctx.fillRect(-nibLength / 2, -nibHeight / 2, nibLength, nibHeight);
			ctx.restore();

			// Interpolate between points to fill gaps and smooth edges
			if (i > 0) {
				const [prevX, prevY, prevPressure = 0.5, prevTwist = 0] = stroke.points[i - 1];
				const dx = x - prevX;
				const dy = y - prevY;
				const distance = Math.sqrt(dx * dx + dy * dy);

				// Draw intermediate rectangles based on distance
				const steps = Math.max(1, Math.floor(distance / 2)); // One rect every 2 pixels
				for (let step = 1; step < steps; step++) {
					const t = step / steps;
					const interpX = prevX + dx * t;
					const interpY = prevY + dy * t;
					const interpPressure = prevPressure + (pressure - prevPressure) * t;
					const interpTwist = prevTwist + (twist - prevTwist) * t;

					const interpNibAngleRad = interpTwist !== 0 ? (interpTwist * Math.PI) / 180 : ((this.calligraphyAngle || 45) * Math.PI) / 180;
					const interpNibWidth = baseNibWidth * (0.7 + interpPressure * 0.3);
					const interpNibLength = interpNibWidth * (0.3 + widthFactor * 0.7);
					const interpNibHeight = interpNibWidth * 0.08;
					const interpOpacity = 0.3 + interpPressure * 0.7;

					ctx.save();
					ctx.globalAlpha = interpOpacity;
					ctx.translate(interpX, interpY);
					ctx.rotate(interpNibAngleRad + Math.PI / 2);
					ctx.fillRect(-interpNibLength / 2, -interpNibHeight / 2, interpNibLength, interpNibHeight);
					ctx.restore();
				}
			}
		}
	}

	drawMarker(ctx, stroke) {
		if (stroke.points.length < 1) return;

		const baseNibWidth = stroke.size * 3;

		// Setup stroke properties
		ctx.strokeStyle = stroke.color;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		// Start path at first point
		const [startX, startY] = stroke.points[0];
		ctx.beginPath();
		ctx.moveTo(startX, startY);

		let prevX = startX;
		let prevY = startY;
		let lastLineWidth = baseNibWidth;

		// Draw smooth curves through all points
		for (let i = 1; i < stroke.points.length; i++) {
			const [x, y, pressure = 0.5, twist = 0] = stroke.points[i];

			// Calculate stroke direction
			const dx = x - prevX;
			const dy = y - prevY;
			const strokeAngle = Math.atan2(dy, dx);

			// Use stylus twist if available, otherwise use fixed calligraphy angle
			const nibAngleRad = twist !== 0 ? (twist * Math.PI) / 180 : ((this.calligraphyAngle || 45) * Math.PI) / 180;

			// Calculate width based on angle difference (calligraphy characteristic)
			const angleDiff = Math.abs(strokeAngle - nibAngleRad);
			const widthFactor = Math.abs(Math.sin(angleDiff));

			// Apply pressure and angle to calculate line width
			const nibWidth = baseNibWidth * (0.7 + pressure * 0.3);
			const lineWidth = nibWidth * (0.3 + widthFactor * 0.7);

			// Only update line width if it changed significantly (>10% change)
			const widthDiff = Math.abs(lineWidth - lastLineWidth);
			if (widthDiff > lastLineWidth * 0.1) {
				ctx.lineWidth = lineWidth;
				lastLineWidth = lineWidth;
			}

			// Draw smooth quadratic curve to midpoint
			const midX = (prevX + x) / 2;
			const midY = (prevY + y) / 2;
			ctx.quadraticCurveTo(prevX, prevY, midX, midY);
			ctx.stroke();

			prevX = x;
			prevY = y;
		}

		// Draw final segment to last point
		if (stroke.points.length > 1) {
			const [lastX, lastY] = stroke.points[stroke.points.length - 1];
			ctx.lineTo(lastX, lastY);
			ctx.stroke();
		}
	}

	drawPencil(ctx, stroke) {
		if (stroke.points.length < 1) return;

		ctx.strokeStyle = stroke.color;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		// Draw each segment with pressure-varying opacity and width
		for (let i = 0; i < stroke.points.length - 1; i++) {
			const [x1, y1, p1 = 0.5, twist1] = stroke.points[i];
			const [x2, y2, p2 = 0.5, twist2] = stroke.points[i + 1];

			// Calculate width and opacity based on pressure
			const width1 = stroke.size * (0.3 + p1 * 0.7);
			const width2 = stroke.size * (0.3 + p2 * 0.7);
			const avgWidth = (width1 + width2) / 2;
			const avgPressure = (p1 + p2) / 2;

			// Extract RGB from color and apply opacity
			const opacity = 0.4 + avgPressure * 0.6;
			ctx.globalAlpha = opacity;
			ctx.lineWidth = avgWidth;

			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
		}

		ctx.globalAlpha = 1.0; // Reset alpha
	}

	drawRuledLines() {
		if (!this.linesCtx) return;

		// Clear lines canvas first
		this.linesCtx.clearRect(0, 0, this.linesCanvas.width, this.linesCanvas.height);

		// Set background color on lines canvas
		const isDark = this.getEffectiveDarkMode();
		this.linesCtx.fillStyle = isDark ? '#000000' : '#ffffff';
		this.linesCtx.fillRect(0, 0, this.linesCanvas.width, this.linesCanvas.height);

		// Only draw lines if enabled
		if (!this.showLines) return;

		// Choose line color based on theme
		const lineColor = isDark ? 'rgba(100, 100, 100, 0.4)' : 'rgba(80, 80, 80, 0.5)';

		// Draw horizontal ruled lines
		this.linesCtx.strokeStyle = lineColor;
		this.linesCtx.lineWidth = 1;

		const totalLineHeight = this.lineHeight + this.lineGap;
		for (let y = this.lineGap; y < this.linesCanvas.height; y += totalLineHeight) {
			this.linesCtx.beginPath();
			this.linesCtx.moveTo(0, y);
			this.linesCtx.lineTo(this.linesCanvas.width, y);
			this.linesCtx.stroke();
		}
	}

	async saveData() {
		// Update canvas data
		this.canvasData.strokes = this.strokes;
		this.canvasData.showLines = this.showLines;
		this.canvasData.penType = this.penType;

		// Save to file
		const filepath = this.embedData.filepath;
		const file = this.plugin.app.vault.getAbstractFileByPath(filepath);

		if (file) {
			await this.plugin.app.vault.modify(file, JSON.stringify(this.canvasData, null, '\t'));
		}
	}

	async extractText() {
		// OCR all strokes on canvas
		if (this.strokes.length === 0) {
			new Notice('No handwriting found. Draw something first.');
			return;
		}

		const settings = this.plugin.settings;
		const provider = settings.ocrProvider || 'myscript';

		// Check if API keys are configured for selected provider
		if (provider === 'myscript') {
			if (!settings.myScriptAppKey || !settings.myScriptHmacKey) {
				new Notice('MyScript API keys not configured. Go to Settings > Annotate to add your keys.');
				return;
			}
		} else if (provider === 'google') {
			if (!settings.googleCloudApiKey) {
				new Notice('Google Cloud API key not configured. Go to Settings > Annotate to add your key.');
				return;
			}
		}

		new Notice(`Extracting text with ${provider === 'myscript' ? 'MyScript' : 'Google Cloud Vision'}...`);

		try {
			if (provider === 'myscript') {
				await this.extractTextWithMyScript();
			} else if (provider === 'google') {
				await this.extractTextWithGoogle();
			}
		} catch (error) {
			new Notice(`OCR Error: ${error.message}`);
			console.error('OCR Error:', error);
		}
	}

	async extractTextWithMyScript() {
		const recognizedText = await this.recognizeStrokesWithMyScript(this.strokes);

		// Show in modal
		new ExtractedTextModal(this.plugin.app, recognizedText, (finalText) => {
			this.insertTextToActiveNote(finalText);
		}).open();
	}

	async recognizeStrokesWithMyScript(strokes) {
		const settings = this.plugin.settings;

		// Convert strokes to MyScript format
		const strokeGroups = [{
			strokes: strokes.map(stroke => ({
				x: stroke.points.map(p => p[0]),
				y: stroke.points.map(p => p[1])
			}))
		}];

		const requestBody = {
			contentType: 'Text',
			configuration: {
				lang: 'en_US',
				export: {
					'text/plain': {}
				}
			},
			strokeGroups: strokeGroups
		};

		try {
			// Authentication
			const applicationKey = settings.myScriptAppKey;
			const hmacKey = settings.myScriptHmacKey;

			const headers = {
				'Content-Type': 'application/json',
				'Accept': 'application/json,text/plain',
				'applicationKey': applicationKey
			};

			// Generate HMAC signature (userKey = applicationKey + hmacKey)
			if (hmacKey && hmacKey.trim() !== '') {
				const userKey = applicationKey + hmacKey;
				headers['hmac'] = await this.generateHmac(userKey, JSON.stringify(requestBody));
			}

			const response = await fetch('https://cloud.myscript.com/api/v4.0/iink/batch', {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				const errorText = await response.text();

				// Check for quota exceeded errors
				if (response.status === 403) {
					throw new Error(`MyScript quota exceeded! You've used all 2000 free requests this month.`);
				}

				throw new Error(`MyScript API error: ${response.status} - ${errorText}`);
			}

			// Increment usage counter
			settings.myScriptUsageCount++;
			await this.plugin.saveSettings();

			// Parse response
			const contentType = response.headers.get('content-type');
			let extractedText = '';

			if (contentType && contentType.includes('application/json')) {
				const result = await response.json();
				if (result['text/plain']) {
					extractedText = result['text/plain'];
				} else if (result.label) {
					extractedText = result.label;
				} else {
					throw new Error('No text found in MyScript response');
				}
			} else {
				// Try to read as text
				extractedText = await response.text();
			}

			return extractedText;

		} catch (error) {
			console.error('MyScript Error:', error);
			throw error;
		}
	}

	async generateHmac(key, message) {
		const encoder = new TextEncoder();
		const keyData = encoder.encode(key);
		const messageData = encoder.encode(message);

		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			keyData,
			{ name: 'HMAC', hash: 'SHA-512' },
			false,
			['sign']
		);

		const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);

		return Array.from(new Uint8Array(signature))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
	}

	async extractTextWithGoogle() {
		const recognizedText = await this.recognizeStrokesWithGoogle(this.strokes);

		// Show in modal
		new ExtractedTextModal(this.plugin.app, recognizedText, (finalText) => {
			this.insertTextToActiveNote(finalText);
		}).open();
	}

	async recognizeStrokesWithGoogle(strokes) {
		const settings = this.plugin.settings;

		// Google Cloud Vision requires a canvas image, so render strokes to temporary canvas
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = this.canvas.width;
		tempCanvas.height = this.canvas.height;
		const tempCtx = tempCanvas.getContext('2d');

		// Fill with white background
		tempCtx.fillStyle = 'white';
		tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

		// Draw all strokes in black
		for (const stroke of strokes) {
			const tempStroke = { ...stroke, color: '#000000' };
			this.drawStroke(tempCtx, tempStroke);
		}

		// Convert canvas to base64 image
		const imageDataUrl = tempCanvas.toDataURL('image/png');
		const imageBase64 = imageDataUrl.split(',')[1];

		// Call Google Cloud Vision API
		const apiKey = settings.googleCloudApiKey;
		const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

		const requestBody = {
			requests: [{
				image: {
					content: imageBase64
				},
				features: [{
					type: 'DOCUMENT_TEXT_DETECTION',
					maxResults: 1
				}]
			}]
		};

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				const errorText = await response.text();

				// Check for quota exceeded errors
				if (response.status === 429) {
					throw new Error(`Google Cloud Vision quota exceeded! You've used all 1000 free requests this month.`);
				}

				if (response.status === 403 && errorText.includes('billing')) {
					throw new Error(`Google Cloud Vision billing issue: ${errorText}`);
				}

				throw new Error(`Google Cloud API error: ${response.status} - ${errorText}`);
			}

			// Increment usage counter
			settings.googleCloudUsageCount++;
			await this.plugin.saveSettings();

			const result = await response.json();

			// Extract text from response
			let extractedText = '';
			if (result.responses && result.responses[0]) {
				const textAnnotations = result.responses[0].textAnnotations;
				if (textAnnotations && textAnnotations.length > 0) {
					extractedText = textAnnotations[0].description;
				} else {
					throw new Error('No text found in Google Cloud response. Try writing more clearly or using a larger pen size.');
				}
			} else {
				throw new Error('Invalid response from Google Cloud Vision API');
			}

			return extractedText;

		} catch (error) {
			console.error('Google Cloud Vision Error:', error);
			throw error;
		}
	}

	insertTextToActiveNote(text) {
		const activeView = this.plugin.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
		if (!activeView) {
			new Notice('No active note to insert text into');
			return;
		}

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		editor.replaceRange(text, cursor);
		new Notice('Text inserted into note');
	}

	onunload() {
		// Cleanup keyboard event listener
		if (this.keydownHandler) {
			this.containerEl.removeEventListener('keydown', this.keydownHandler);
		}

		// Cleanup scroll event listener
		if (this.canvasWrapper && this.handlePositionUpdater) {
			this.canvasWrapper.removeEventListener('scroll', this.handlePositionUpdater);
		}

		// Cleanup wrapper resize observer
		if (this.wrapperResizeObserver) {
			this.wrapperResizeObserver.disconnect();
		}
	}
}

// ==================== EXTRACTED TEXT MODAL ====================

class ExtractedTextModal extends Modal {
	constructor(app, extractedText, onSubmit) {
		super(app);
		this.extractedText = extractedText;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Extracted Text' });
		contentEl.createEl('p', {
			text: 'Review and edit the extracted text:',
			cls: 'modal-description'
		});

		const textarea = contentEl.createEl('textarea', {
			cls: 'extracted-text-area'
		});
		textarea.value = this.extractedText;
		textarea.rows = 10;
		textarea.style.width = '100%';
		textarea.style.fontFamily = 'monospace';
		textarea.style.padding = '8px';
		textarea.style.marginBottom = '12px';

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.justifyContent = 'flex-end';

		const insertBtn = buttonContainer.createEl('button', {
			text: 'Insert into Note',
			cls: 'mod-cta'
		});
		insertBtn.addEventListener('click', () => {
			this.onSubmit(textarea.value);
			this.close();
		});

		const copyBtn = buttonContainer.createEl('button', {
			text: 'Copy to Clipboard'
		});
		copyBtn.addEventListener('click', async () => {
			await navigator.clipboard.writeText(textarea.value);
			new Notice('Text copied to clipboard!');
			this.close();
		});

		const cancelBtn = buttonContainer.createEl('button', {
			text: 'Cancel'
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ==================== SETTINGS TAB ====================

class AnnotateSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Annotate Plugin Settings' });

		// OCR Provider
		new Setting(containerEl)
			.setName('OCR Provider')
			.setDesc('Choose between MyScript (2000 free/month) or Google Cloud Vision (1000 free/month)')
			.addDropdown(dropdown => dropdown
				.addOption('myscript', 'MyScript')
				.addOption('google', 'Google Cloud Vision')
				.setValue(this.plugin.settings.ocrProvider)
				.onChange(async (value) => {
					this.plugin.settings.ocrProvider = value;
					await this.plugin.saveSettings();
				}));

		// API Usage Tracking
		containerEl.createEl('h4', { text: 'API Usage Tracking' });

		const myScriptUsage = this.plugin.settings.myScriptUsageCount || 0;
		const googleCloudUsage = this.plugin.settings.googleCloudUsageCount || 0;

		const usageContainer = containerEl.createDiv({ cls: 'usage-tracking-container' });
		usageContainer.style.padding = '12px';
		usageContainer.style.backgroundColor = 'var(--background-secondary)';
		usageContainer.style.borderRadius = '6px';
		usageContainer.style.marginBottom = '15px';

		const myScriptUsageEl = usageContainer.createDiv();
		myScriptUsageEl.innerHTML = `<strong>MyScript:</strong> ${myScriptUsage} / 2000 requests`;
		myScriptUsageEl.style.marginBottom = '8px';
		myScriptUsageEl.style.fontSize = '14px';

		const googleCloudUsageEl = usageContainer.createDiv();
		googleCloudUsageEl.innerHTML = `<strong>Google Cloud Vision:</strong> ${googleCloudUsage} / 1000 requests`;
		googleCloudUsageEl.style.fontSize = '14px';

		new Setting(containerEl)
			.setName('Reset Usage Counters')
			.setDesc('Reset API usage counters (typically done monthly)')
			.addButton(button => button
				.setButtonText('Reset All Counters')
				.onClick(async () => {
					this.plugin.settings.myScriptUsageCount = 0;
					this.plugin.settings.googleCloudUsageCount = 0;
					this.plugin.settings.usageResetDate = new Date().toISOString();
					await this.plugin.saveSettings();
					new Notice('Usage counters reset');
					this.display(); // Refresh the settings display
				}));

		// MyScript API Keys
		containerEl.createEl('h3', { text: 'MyScript API' });

		new Setting(containerEl)
			.setName('MyScript Application Key')
			.setDesc('Get free API key at developer.myscript.com')
			.addText(text => text
				.setPlaceholder('Enter application key')
				.setValue(this.plugin.settings.myScriptAppKey)
				.onChange(async (value) => {
					this.plugin.settings.myScriptAppKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('MyScript HMAC Key')
			.setDesc('HMAC key from MyScript dashboard')
			.addText(text => text
				.setPlaceholder('Enter HMAC key')
				.setValue(this.plugin.settings.myScriptHmacKey)
				.onChange(async (value) => {
					this.plugin.settings.myScriptHmacKey = value;
					await this.plugin.saveSettings();
				}));

		// Google Cloud Vision API
		containerEl.createEl('h3', { text: 'Google Cloud Vision API' });

		new Setting(containerEl)
			.setName('Google Cloud API Key')
			.setDesc('Get API key from Google Cloud Console')
			.addText(text => text
				.setPlaceholder('Enter API key')
				.setValue(this.plugin.settings.googleCloudApiKey)
				.onChange(async (value) => {
					this.plugin.settings.googleCloudApiKey = value;
					await this.plugin.saveSettings();
				}));

		// Drawing Defaults
		containerEl.createEl('h3', { text: 'Drawing Defaults' });

		new Setting(containerEl)
			.setName('Default Pen Type')
			.setDesc('Pen type for new annotations')
			.addDropdown(dropdown => dropdown
				.addOption('fountain', 'Fountain Pen')
				.addOption('calligraphy', 'Calligraphy Nib')
				.addOption('pencil', 'Pencil')
				.setValue(this.plugin.settings.defaultPenType)
				.onChange(async (value) => {
					this.plugin.settings.defaultPenType = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Canvas Width')
			.setDesc('Width in pixels')
			.addText(text => text
				.setPlaceholder('800')
				.setValue(String(this.plugin.settings.defaultCanvasWidth))
				.onChange(async (value) => {
					this.plugin.settings.defaultCanvasWidth = Number(value) || 800;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Canvas Height')
			.setDesc('Height in pixels')
			.addText(text => text
				.setPlaceholder('400')
				.setValue(String(this.plugin.settings.defaultCanvasHeight))
				.onChange(async (value) => {
					this.plugin.settings.defaultCanvasHeight = Number(value) || 400;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Stroke Smoothing')
			.setDesc('Stabilize shaky hands (0 = off, 10 = maximum smoothing)')
			.addSlider(slider => slider
				.setLimits(0, 10, 1)
				.setValue(this.plugin.settings.smoothingLevel)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.smoothingLevel = value;
					await this.plugin.saveSettings();
				}));

		// Storage
		containerEl.createEl('h3', { text: 'Storage' });

		new Setting(containerEl)
			.setName('Data Folder Path')
			.setDesc('Folder for annotation data files')
			.addText(text => text
				.setPlaceholder('.annotate-data')
				.setValue(this.plugin.settings.dataFolderPath)
				.onChange(async (value) => {
					this.plugin.settings.dataFolderPath = value || '.annotate-data';
					await this.plugin.saveSettings();
				}));
	}
}

module.exports = AnnotatePlugin;
