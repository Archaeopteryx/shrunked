let ShrunkedCompose = {
	OPTIONS_DIALOG: 'chrome://shrunked/content/options.xul',
	POPUP_ARGS: 'chrome,centerscreen,modal',

	droppedCache: new Map(),
	inlineImages: [],
	timeout: null,

	init: function ShrunkedCompose_init() {
		this.oldGenericSendMessage = window.GenericSendMessage;
		window.GenericSendMessage = this.newGenericSendMessage.bind(this);

		// the editor's document isn't available immediately
		let editFrame = document.getElementById('content-frame');
		editFrame.addEventListener('pageshow', function addObserver() {
			editFrame.removeEventListener('pageshow', addObserver, false);
			let target = editFrame.contentDocument.body;
			let config = { attributes: false, childList: true, characterData: false };
			let observer = new MutationObserver(function(mutations) {
				for (let mutation of mutations) {
					if (mutation.addedNodes && mutation.addedNodes.length) {
						Shrunked.log('Nodes added to message: ' + mutation.addedNodes.length);
						for (let target of mutation.addedNodes) {
							ShrunkedCompose.maybeResizeInline(target);
						}
					}
				}
			});
			observer.observe(target, config);
		});
		editFrame.addEventListener('drop', (event) => {
			for (let file of event.dataTransfer.files) {
				Shrunked.log('File dropped: ' + file.name);
				ShrunkedCompose.droppedCache.set(file.name, file.size);
			}
		});

		let context = document.getElementById('msgComposeContext') || document.getElementById('contentAreaContextMenu');
		context.addEventListener('popupshowing', function() {
			let target = document.popupNode;
			let shouldShow = false;
			if (target.nodeName == 'IMG') {
				Shrunked.log('Context menu on an <IMG>');
				if (Shrunked.imageIsJPEG(target)) {
					if (target.width > 500 || target.height > 500) {
						shouldShow = true;
					} else {
						Shrunked.log('Not resizing - image is too small');
					}
				} else {
					Shrunked.log('Not resizing - image is not JPEG');
				}
			}
			document.getElementById('shrunked-context-item').style.display = shouldShow ? null : 'none';
			document.getElementById('shrunked-context-separator').style.display = shouldShow ? null : 'none';
		});
	},
	maybeResizeInline: function ShrunkedCompose_maybeResizeInline(target) {
		if (target.nodeName == 'IMG') {
			try {
				Shrunked.log('<IMG> found, source is ' + target.src.substring(0, 200) + (target.src.length <= 200 ? '' : '\u2026'));
				let parent = target.parentNode;
				while (parent && 'classList' in parent) {
					if (parent.classList.contains('moz-signature')) {
					Shrunked.log('Not resizing - image is part of signature');
						return;
					}
					if (parent.getAttribute('type') == 'cite') {
						Shrunked.log('Not resizing - image is part of message being replied to');
						return;
					}
					if (parent.classList.contains('moz-forward-container')) {
						Shrunked.log('Not resizing - image is part of forwarded message');
						return;
					}
					parent = parent.parentNode;
				}

				if (!target.complete) {
					target.addEventListener('load', function targetOnLoad() {
						target.removeEventListener('load', targetOnLoad, false);
						Shrunked.log('Image now loaded, calling maybeResizeInline');
						ShrunkedCompose.maybeResizeInline(target);
					});
					Shrunked.log('Image not yet loaded');
					return;
				}

				if (target.hasAttribute('shrunked:resized')) {
					Shrunked.log('Not resizing - image already has shrunked attribute');
					return;
				}
				if (!Shrunked.imageIsJPEG(target)) {
					Shrunked.log('Not resizing - image is not JPEG');
					return;
				}
				if (target.width < 500 && target.height < 500) {
					Shrunked.log('Not resizing - image is too small');
					return;
				}

				let src = target.getAttribute('src');
				if (/^data:/.test(src)) {
					src = src.substring(src.indexOf(',') + 1);
					let srcSize = src.length * 3 / 4;
					if (src.substr(-1) == '=') {
						srcSize--;
						if (src.substr(-2, 1) == '=') {
							srcSize--;
						}
					}
					if (srcSize < Shrunked.fileSizeMinimum) {
						Shrunked.log('Not resizing - image file size is too small');
						return;
					}
					for (let [name, size] of this.droppedCache) {
						if (srcSize == size) {
							target.maybesrc = name;
							break;
						}
					}
				} else if (/^file:/.test(src) && !Shrunked.fileLargerThanThreshold(src)) {
					Shrunked.log('Not resizing - image file size is too small');
					return;
				}

				this.inlineImages.push(target);
				if (this.timeout) {
					clearTimeout(this.timeout);
				}

				let notifyBox = document.getElementById('shrunked-notification-box');
				if (notifyBox.childElementCount > 0) {
					Shrunked.log('Notification already visible');
					return;
				}

				this.timeout = setTimeout(() => {
					Shrunked.log('Showing resize notification');
					this.timeout = null;
					this.droppedCache.clear();

					let buttons = [{
						accessKey: Shrunked.strings.GetStringFromName('yes_accesskey'),
						callback: () => {
							this.showOptionsDialog(this.inlineImages);
							this.inlineImages = [];
						},
						label: Shrunked.strings.GetStringFromName('yes_label')
					}, {
						accessKey: Shrunked.strings.GetStringFromName('no_accesskey'),
						callback: () => {
							for (let img of this.inlineImages) {
								img.setAttribute('shrunked:resized', 'false');
							}
							this.inlineImages = [];
						},
						label: Shrunked.strings.GetStringFromName('no_label')
					}];

					let questions = Shrunked.strings.GetStringFromName('questions');
					let question = Shrunked.getPluralForm(this.inlineImages.length, questions);

					let notification = notifyBox.appendNotification(
						question, 'shrunked-notification', Shrunked.icon16, notifyBox.PRIORITY_INFO_HIGH, buttons
					);
				}, 500);
			} catch (e) {
				Components.utils.reportError(e);
			}
		} else if (target.nodeType == Node.ELEMENT_NODE) {
			Shrunked.log('<' + target.nodeName + '> found, checking children');
			for (let child of target.children) {
				this.maybeResizeInline(child);
			}
		}
	},
	showOptionsDialog: function ShrunkedCompose_showOptionsDialog(images) {
		let returnValues = { cancelDialog: true };
		let imageURLs = [];
		let imageNames = [];
		for (let image of images) {
			imageURLs.push(image.src);
			imageNames.push(image.maybesrc);
		}

		window.openDialog(this.OPTIONS_DIALOG, 'options', this.POPUP_ARGS, returnValues, imageURLs, imageNames);

		if (returnValues.cancelDialog) {
			return;
		}

		Task.spawn((function*() {
			let {maxWidth, maxHeight} = returnValues;
			let quality = Shrunked.prefs.getIntPref('default.quality');
			let count = 0;
			this.setStatus(images.length);
			for (let image of images) {
				try {
					let destFile = yield Shrunked.resize(image.src, maxWidth, maxHeight, quality, image.maybesrc);
					image.src = Services.io.newFileURI(new FileUtils.File(destFile)).spec;
					image.removeAttribute('width');
					image.removeAttribute('height');
					image.setAttribute('shrunked:resized', 'true');
					this.setStatusCount(++count);
				} catch (ex) {
					Components.utils.reportError(ex);
				}
			}
			this.clearStatus();
		}).bind(this)).catch(function(error) {
			Components.utils.reportError(error);
		});
	},
	newGenericSendMessage: function ShrunkedCompose_newGenericSendMessage(msgType) {
		let doResize = msgType == nsIMsgCompDeliverMode.Now || msgType == nsIMsgCompDeliverMode.Later;
		let images = [];

		try {
			if (doResize) {
				let bucket = document.getElementById('attachmentBucket');
				let imageURLs = [];

				for (let index = 0; index < bucket.getRowCount(); index++) {
					let item = bucket.getItemAtIndex(index);
					if (/\.jpe?g$/i.test(item.attachment.url) && item.attachment.size >= Shrunked.fileSizeMinimum) {
						Shrunked.log('JPEG attachment found, source is ' + item.attachment.size);
						images.push({ url: item.attachment.url, item: item });
						imageURLs.push(item.attachment.url);
					}
				}

				if (images.length > 0) {
					Shrunked.log('Offering to resize ' + images.length + ' attachments');
					let returnValues = { cancelDialog: true, isAttachment: true };
					window.openDialog(this.OPTIONS_DIALOG, 'options', this.POPUP_ARGS, returnValues, imageURLs);
					if (returnValues.cancelDialog) {
						return;
					}
					if (returnValues.maxWidth > 0) {
						Task.spawn((function*() {
							let {maxWidth, maxHeight} = returnValues;
							let quality = Shrunked.prefs.getIntPref('default.quality');
							let count = 0;
							this.setStatus(images.length);
							for (let image of images) {
								try {
									let item = image.item;
									let destFile = yield Shrunked.resize(image.url, maxWidth, maxHeight, quality);
									item.attachment.contentLocation = item.attachment.url;
									item.attachment.url = Services.io.newFileURI(new FileUtils.File(destFile)).spec;
									this.setStatusCount(++count);
								} catch (ex) {
									Components.utils.reportError(ex);
								}
							}
							this.clearStatus();
							finish();
						}).bind(this)).catch(function(error) {
							Components.utils.reportError(error);
						});
						return;
					}
				}
			}

			finish();
		} catch (e) {
			Components.utils.reportError(e);
		}

		function finish() {
			ShrunkedCompose.oldGenericSendMessage(msgType);

			// undo, in case send failed
			if (doResize) {
				for (let image of images) {
					let item = image.item;
					let contentLocation = item.attachment.contentLocation;
					if (contentLocation && /\.jpe?g$/i.test(contentLocation)) {
						item.attachment.url = contentLocation;
						item.attachment.contentLocation = null;
					}
				}
			}
		}
	},
	setStatus: function ShrunkedCompose_setStatus(total) {
		let statusText = document.getElementById('statusText');
		let meter = document.getElementById('compose-progressmeter');
		let statuses = Shrunked.strings.GetStringFromName('status_resizing');

		ToggleWindowLock(true);
		statusText.setAttribute('label', Shrunked.getPluralForm(total, statuses));
		meter.setAttribute('mode', total == 1 ? 'undetermined' : 'normal');
		meter.setAttribute('value', 0);
		meter.setAttribute('max', total);
		meter.parentNode.collapsed = false;
	},
	setStatusCount: function ShrunkedCompose_setStatusCount(count) {
		let meter = document.getElementById('compose-progressmeter');

		meter.setAttribute('value', count);
	},
	clearStatus: function ShrunkedCompose_clearStatus() {
		let statusText = document.getElementById('statusText');
		let meter = document.getElementById('compose-progressmeter');

		ToggleWindowLock(false);
		statusText.setAttribute('label', '');
		meter.setAttribute('value', 0);
		meter.removeAttribute('max');
		meter.parentNode.collapsed = true;
	}
};

Components.utils.import('resource://gre/modules/XPCOMUtils.jsm');
XPCOMUtils.defineLazyModuleGetter(window, 'FileUtils', 'resource://gre/modules/FileUtils.jsm');
XPCOMUtils.defineLazyModuleGetter(window, 'Promise', 'resource://gre/modules/Promise.jsm');
XPCOMUtils.defineLazyModuleGetter(window, 'Services', 'resource://gre/modules/Services.jsm');
XPCOMUtils.defineLazyModuleGetter(window, 'Shrunked', 'resource://shrunked/Shrunked.jsm');
XPCOMUtils.defineLazyModuleGetter(window, 'Task', 'resource://gre/modules/Task.jsm');

window.addEventListener('load', ShrunkedCompose.init.bind(ShrunkedCompose));
