const state = {
  files: [],
  currentIndex: 0,
  filteredFiles: [],
  filter: 'all',
  folderName: 'No folder selected',
  directoryHandle: null,
  renameHistory: [],
  lastStatus: 'Idle'
};

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const dom = {
  selectFolderBtn: document.getElementById('selectFolderBtn'),
  openPdfBtn: document.getElementById('openPdfBtn'),
  processBtn: document.getElementById('processBtn'),
  folderInput: document.getElementById('folderInput'),
  pdfInput: document.getElementById('pdfInput'),
  folderName: document.getElementById('folderName'),
  processedCount: document.getElementById('processedCount'),
  fileList: document.getElementById('fileList'),
  docTitle: document.getElementById('docTitle'),
  pageCounter: document.getElementById('pageCounter'),
  previewWrap: document.getElementById('previewWrap'),
  emptyState: document.getElementById('emptyState'),
  pdfCanvas: document.getElementById('pdfCanvas'),
  prevPageBtn: document.getElementById('prevPageBtn'),
  nextPageBtn: document.getElementById('nextPageBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  detailsBox: document.getElementById('docDetails'),
  approveBtn: document.getElementById('approveBtn'),
  editNameBtn: document.getElementById('editNameBtn'),
  skipBtn: document.getElementById('skipBtn'),
  reviewLaterBtn: document.getElementById('reviewLaterBtn'),
  undoBtn: document.getElementById('undoBtn'),
  manualNameInput: document.getElementById('manualNameInput'),
  statusBar: document.getElementById('statusBar'),
  searchInput: document.getElementById('searchInput'),
  filterButtons: document.querySelectorAll('.filter')
};

const statusMap = {
  pending: { label: 'Pending', className: 'pending' },
  approved: { label: 'Approved', className: 'approved' },
  'needs-review': { label: 'Review', className: 'review' },
  handwritten: { label: 'Handwritten', className: 'handwritten' },
  failed: { label: 'Failed', className: 'failed' },
  skipped: { label: 'Skipped', className: 'skipped' }
};

let currentPage = 1;
let zoom = 1;

function setStatus(text, tone = 'neutral') {
  const map = {
    neutral: 'status-pill neutral',
    success: 'status-pill success',
    warning: 'status-pill warning',
    danger: 'status-pill danger'
  };
  dom.statusBar.innerHTML = `<span class="${map[tone]}">${text}</span>`;
}

function updateApprovalButtonLabel() {
  const supportsInPlaceRename = window.location.protocol !== 'file:' && window.isSecureContext && typeof window.showDirectoryPicker === 'function';
  dom.approveBtn.textContent = supportsInPlaceRename ? 'Approve & Rename' : 'Approve & Download';
  dom.approveBtn.dataset.tooltip = supportsInPlaceRename
    ? 'Rename this original PDF in place after granting folder write access.'
    : 'Download a renamed copy. The original PDF will not be changed in this mode.';
  dom.selectFolderBtn.dataset.tooltip = supportsInPlaceRename
    ? 'Choose a folder and grant write access to rename original PDFs in place.'
    : 'Load a folder for read-only review. Open the app on localhost in a supported browser to rename originals in place.';
}

function sanitizeFilename(rawName) {
  const cleaned = String(rawName || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'Unnamed Person';
}

function generateUniqueName(baseName, existingNames) {
  const sanitized = sanitizeFilename(baseName);
  if (!existingNames.includes(sanitized + '.pdf')) {
    return sanitized + '.pdf';
  }

  let counter = 2;
  let candidate = `${sanitized} (${counter}).pdf`;
  while (existingNames.includes(candidate)) {
    counter += 1;
    candidate = `${sanitized} (${counter}).pdf`;
  }
  return candidate;
}

function updateProcessedCount() {
  const done = state.files.filter((record) => record.status !== 'pending' && record.status !== 'processing').length;
  dom.processedCount.textContent = `${done} / ${state.files.length}`;
}

function buildUrlName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'person';
}

function getVisibleFiles() {
  const query = dom.searchInput.value.trim().toLowerCase();
  return state.files.filter((record) => {
    const matchesQuery = !query || [
      record.file.name,
      record.primaryName || '',
      record.approvedName || '',
      record.status
    ].join(' ').toLowerCase().includes(query);

    const matchesFilter = state.filter === 'all' || record.status === state.filter ||
      (state.filter === 'needs-review' && (record.status === 'needs-review' || record.status === 'handwritten')) ||
      (state.filter === 'approved' && record.status === 'approved') ||
      (state.filter === 'handwritten' && record.status === 'handwritten') ||
      (state.filter === 'failed' && record.status === 'failed');

    return matchesQuery && matchesFilter;
  });
}

function renderFileList() {
  const visibleFiles = getVisibleFiles();
  state.filteredFiles = visibleFiles;

  if (!visibleFiles.length) {
    dom.fileList.innerHTML = '<div class="empty-state">No PDFs match the selected filter.</div>';
    return;
  }

  dom.fileList.innerHTML = visibleFiles.map((record, index) => {
    const status = statusMap[record.status] || statusMap.pending;
    const active = state.currentIndex === record.index ? 'active' : '';
    return `
      <div class="file-item ${active}" data-index="${record.index}" role="button" tabindex="0" data-tooltip="Select this PDF to preview it and review its primary name.">
        <div class="filename">
          <strong>${record.file.name}</strong>
          ${record.primaryName ? `<small>${record.primaryName}</small>` : ''}
        </div>
        <span class="tag ${status.className}">${status.label}</span>
      </div>
    `;
  }).join('');

  dom.fileList.querySelectorAll('.file-item').forEach((item) => {
    item.addEventListener('click', () => {
      const idx = Number(item.dataset.index);
      const record = state.files[idx];
      if (!record) return;
      state.currentIndex = idx;
      renderFileList();
      renderCurrentRecord();
    });
  });
}

async function ensurePreview(record) {
  if (!record || record.previewImage || record.previewLoading) return;
  record.previewLoading = true;

  try {
    const buffer = await record.file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const images = [];

    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const rendered = await renderPdfPageToCanvas(page, n);
      images.push(rendered.imageData);
    }

    record.pageCount = pdf.numPages;
    record.pageImages = images;
    record.previewImage = images[0] || '';
  } catch (error) {
    record.status = 'failed';
    record.errorMessage = error.message || 'Unable to preview this PDF.';
    renderFileList();
  } finally {
    record.previewLoading = false;
  }

  if (state.files[state.currentIndex] === record) renderCurrentRecord();
}

function renderCurrentRecord() {
  const currentRecord = state.files[state.currentIndex];
  if (!currentRecord) {
    dom.docTitle.textContent = 'No PDF selected';
    dom.emptyState.hidden = false;
    dom.emptyState.textContent = 'Select a PDF or folder to preview the document here.';
    dom.pdfCanvas.hidden = true;
    return;
  }

  const totalPages = currentRecord.pageCount || currentRecord.pageImages?.length || 1;
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  dom.docTitle.textContent = currentRecord.file.name;

  const previewImage = currentRecord.pageImages?.[currentPage - 1] || currentRecord.previewImage;

  if (previewImage) {
    dom.emptyState.hidden = true;
    dom.pdfCanvas.hidden = false;
    const ctx = dom.pdfCanvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      const width = img.width * zoom;
      const height = img.height * zoom;
      dom.pdfCanvas.width = width;
      dom.pdfCanvas.height = height;
      ctx.clearRect(0, 0, dom.pdfCanvas.width, dom.pdfCanvas.height);
      ctx.drawImage(img, 0, 0, width, height);
      dom.pageCounter.textContent = `Page ${currentPage} / ${totalPages}`;
    };
    img.src = previewImage;
  } else {
    dom.emptyState.hidden = false;
    dom.emptyState.textContent = currentRecord.status === 'failed'
      ? (currentRecord.errorMessage || 'Unable to preview this PDF.')
      : 'The document preview is loading. Please wait a moment.';
    dom.pdfCanvas.hidden = true;
    if (currentRecord.status !== 'failed') ensurePreview(currentRecord);
  }

  dom.manualNameInput.value = currentRecord.primaryName || '';
  renderDetails(currentRecord);
}

function renderDetails(record) {
  const primary = record.primaryName || 'Manual review required';

  dom.detailsBox.innerHTML = `
    <h4>Document Summary</h4>
    <div class="meta">
      Primary name: <strong>${primary}</strong><br />
      Suggested filename: <strong>${sanitizeFilename(primary)}.pdf</strong><br />
      Status: ${record.status}<br />
      OCR confidence: ${record.ocrConfidence ?? 'N/A'}<br />
      Notes: ${record.manualReview ? 'Manual review required.' : 'Review the primary name before renaming.'}
    </div>
  `;

  if (currentPage > (record.pageCount || 1)) {
    currentPage = 1;
  }
  dom.pageCounter.textContent = `Page ${currentPage} / ${record.pageCount || 1}`;
}

function getDocumentTextFromPdfData(pdf) {
  return pdf.getTextContent ? pdf.getTextContent() : Promise.resolve({ items: [] });
}

function runOCROnCanvas(canvas) {
  if (!window.Tesseract || !canvas) {
    return Promise.resolve({ text: '', confidence: 0 });
  }

  return window.Tesseract.recognize(canvas.toDataURL('image/png'), 'eng', {
    logger: () => {}
  }).then((result) => ({
    text: result.data.text || '',
    confidence: result.data.confidence || 0
  }));
}

function renderPdfPageToCanvas(page, pageNumber) {
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  return page.render({ canvasContext: context, viewport }).promise.then(() => {
    const imageData = canvas.toDataURL('image/png');
    return { imageData, canvas, pageNumber };
  });
}

async function renderSelectedPdf(file) {
  if (!file || !/\.pdf$/i.test(file.name)) {
    setStatus('Please select a valid PDF file.', 'warning');
    return;
  }

  const record = {
    index: 0,
    file,
    primaryName: '',
    approvedName: '',
    status: 'pending',
    previewImage: '',
    pageCount: 0,
    pageImages: [],
    ocrConfidence: 0,
    manualReview: false,
    errorMessage: ''
  };

  state.renameHistory = [];
  state.files = [record];
  state.currentIndex = 0;
  state.folderName = file.name;
  dom.folderName.textContent = file.name;
  currentPage = 1;
  renderFileList();
  renderCurrentRecord();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageImages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const rendered = await renderPdfPageToCanvas(page, pageNumber);
      pageImages.push(rendered.imageData);
    }

    record.pageCount = pdf.numPages;
    record.previewImage = pageImages[0] || '';
    record.pageImages = pageImages;
    currentPage = 1;
    setStatus(`Preview loaded: ${file.name}`, 'success');
    renderCurrentRecord();
    await analyzePdf(record);
  } catch (error) {
    record.status = 'failed';
    record.errorMessage = error.message || 'Unable to preview this PDF.';
    setStatus('Preview failed for this PDF.', 'danger');
    renderFileList();
    renderCurrentRecord();
  }
}

function isHandwritingLikeText(text) {
  if (!text) return false;
  const normalized = String(text).toLowerCase();
  return /(signature|signed|handwritten|illegible|unclear|initials?|thumb mark|scanned signature|by\s*[:)]|manuscript)/i.test(normalized);
}

async function analyzePdf(record) {
  record.status = 'processing';
  try {
    const arrayBuffer = await record.file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageTextEntries = [];
    const previewPages = [];
    let totalOcrConfidence = 0;
    let pageCount = pdf.numPages;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(' ');
      const cleanedText = isHandwritingLikeText(pageText) ? '' : (pageText || '');
      pageTextEntries.push({ page: pageNumber, text: cleanedText });

      const rendered = await renderPdfPageToCanvas(page, pageNumber);
      previewPages.push(rendered.imageData);

      if (cleanedText.trim()) {
        totalOcrConfidence += 90;
      } else {
        const ocrResult = await runOCROnCanvas(rendered.canvas);
        totalOcrConfidence += ocrResult.confidence || 0;
        if ((ocrResult.text || '').trim()) {
          const recognizedText = ocrResult.text || '';
          pageTextEntries[pageTextEntries.length - 1].text = isHandwritingLikeText(recognizedText) ? '' : recognizedText;
        }
      }
    }

    const ocrConfidence = pageCount ? Math.round(totalOcrConfidence / pageCount) : 0;
    const manualReview = ocrConfidence < 50 && pageTextEntries.every((entry) => !entry.text.trim());

    record.pageCount = pageCount;
    record.pageText = pageTextEntries;
    record.pageImages = previewPages;
    record.ocrConfidence = ocrConfidence;
    record.previewImage = previewPages[0] || '';
    record.manualReview = manualReview;
    record.status = manualReview ? 'needs-review' : 'pending';

    if (record.pageText.some((entry) => isHandwritingLikeText(entry.text))) {
      record.status = 'handwritten';
      record.manualReview = true;
    }

    setStatus(`Processed ${record.file.name}`, 'success');
    updateProcessedCount();
    renderFileList();
    renderCurrentRecord();
  } catch (error) {
    record.status = 'failed';
    record.errorMessage = error.message || 'Processing failed';
    setStatus(`Failed: ${record.file.name}`, 'danger');
    updateProcessedCount();
    renderFileList();
    renderCurrentRecord();
  }
}

async function processFolder(files) {
  const pdfFiles = [...files].filter((file) => /\.pdf$/i.test(file.name));
  if (!pdfFiles.length) {
    setStatus('No PDF files found in the selected folder.', 'warning');
    return;
  }

  state.renameHistory = [];
  state.files = pdfFiles.map((file, index) => ({
    index,
    file,
    primaryName: '',
    approvedName: '',
    status: 'pending',
    previewImage: '',
    pageCount: 0,
    ocrConfidence: 0,
    manualReview: false,
    errorMessage: ''
  }));

  state.currentIndex = 0;
  state.filter = 'all';
  dom.searchInput.value = '';
  dom.folderName.textContent = state.folderName || 'Folder selected';
  updateProcessedCount();
  renderFileList();
  renderCurrentRecord();

  if (state.files[0]) {
    await ensurePreview(state.files[0]);
  }

  for (const record of state.files) {
    await analyzePdf(record);
  }
}

async function selectFolderUsingPicker() {
  const supportsDirectoryPicker = !!window.showDirectoryPicker;

  if (window.location.protocol === 'file:') {
    state.directoryHandle = null;
    updateApprovalButtonLabel();
    setStatus('Select a folder to process PDFs. Approved names will download as copies.', 'neutral');
    dom.folderInput.click();
    return;
  }

  if (!window.isSecureContext || !supportsDirectoryPicker) {
    setStatus('In-place folder renaming requires a secure browser context. Open this app at http://localhost or HTTPS in a browser that supports folder access.', 'warning');
    return;
  }

  setStatus('Choose the folder containing the PDFs to rename.', 'neutral');

  let directoryHandle;
  try {
    directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus('The folder picker closed before a folder was selected.', 'neutral');
    } else if (error.name === 'SecurityError') {
      setStatus('The browser blocked folder access. Open this app at http://localhost or HTTPS, then try again.', 'warning');
    } else {
      setStatus(`Could not open the folder picker: ${error.message || 'Unknown error'}`, 'danger');
    }
    return;
  }

  state.directoryHandle = directoryHandle;
  state.folderName = directoryHandle.name || 'Selected folder';
  dom.folderName.textContent = state.folderName;
  updateApprovalButtonLabel();

  try {
    const permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      state.directoryHandle = null;
      updateApprovalButtonLabel();
      setStatus('Write access was not granted for that folder. Select it again and allow changes.', 'warning');
      return;
    }

    const files = [];
    for await (const entry of directoryHandle.values()) {
      if (entry.kind === 'file' && /\.pdf$/i.test(entry.name)) {
        files.push(await entry.getFile());
      }
    }

    if (!files.length) {
      setStatus('No PDF files were found in the selected folder.', 'warning');
      return;
    }

    await processFolder(files);
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus('The folder was selected, but write permission or folder access was cancelled. Allow access and try again.', 'warning');
    } else if (error.name === 'SecurityError') {
      setStatus('The browser blocked folder access. Open this app at http://localhost or HTTPS, then try again.', 'warning');
    } else {
      setStatus(`Folder access failed: ${error.message || 'Unknown error'}`, 'danger');
    }
  }
}

function applyFilter(filter) {
  state.filter = filter;
  dom.filterButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === filter);
  });
  renderFileList();
}

function handleManualRename() {
  const current = state.files[state.currentIndex];
  if (!current) return;
  const name = dom.manualNameInput.value.trim();
  if (!name) {
    setStatus('Enter a valid name before approving.', 'warning');
    return;
  }

  current.primaryName = name;
  current.status = 'needs-review';
  current.approvedName = '';
  renderFileList();
  renderCurrentRecord();
  const supportsInPlaceRename = window.location.protocol !== 'file:' && window.isSecureContext && typeof window.showDirectoryPicker === 'function';
  const nextStep = state.directoryHandle
    ? 'Approve to rename the original PDF.'
    : supportsInPlaceRename
      ? 'Select the folder before approving to rename the original PDF.'
    : 'Approve to download a renamed copy; the original will stay unchanged.';
  setStatus(`Name updated for ${current.file.name}. ${nextStep}`, 'success');
}

async function renameInSelectedFolder(directoryHandle, sourceName, targetName) {
  const sourceHandle = await directoryHandle.getFileHandle(sourceName, { create: false });

  if (typeof sourceHandle.move === 'function') {
    try {
      await sourceHandle.move(targetName);
      return;
    } catch (error) {
      console.warn('Direct file rename failed; trying a write-and-remove rename:', error);
    }
  }

  let targetCreated = false;
  try {
    const targetHandle = await directoryHandle.getFileHandle(targetName, { create: true });
    targetCreated = true;
    const writable = await targetHandle.createWritable();
    try {
      await writable.write(await sourceHandle.getFile());
      await writable.close();
    } catch (error) {
      await writable.abort();
      throw error;
    }
    await directoryHandle.removeEntry(sourceName);
  } catch (error) {
    if (targetCreated) {
      await directoryHandle.removeEntry(targetName).catch(() => {});
    }
    throw error;
  }
}

async function approveRename() {
  const current = state.files[state.currentIndex];
  if (!current) return;

  const enteredName = dom.manualNameInput.value.trim() || current.primaryName;
  if (!enteredName) {
    setStatus('No valid primary name is available to rename.', 'warning');
    return;
  }

  const finalName = sanitizeFilename(enteredName);
  const otherNames = state.files
    .filter((record) => record !== current)
    .map((record) => record.approvedName || record.file.name);
  const targetName = generateUniqueName(finalName, otherNames);
  const sourceName = current.file.name;
  const previousStatus = current.status;
  const previousApprovedName = current.approvedName || '';
  const supportsInPlaceRename = window.location.protocol !== 'file:' && window.isSecureContext && typeof window.showDirectoryPicker === 'function';

  if (!state.directoryHandle && supportsInPlaceRename) {
    setStatus('Select the folder with Select Folder before approving to rename the original PDF.', 'warning');
    return;
  }

  if (!state.directoryHandle) {
    const downloadUrl = URL.createObjectURL(current.file);
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = targetName;
    downloadLink.hidden = true;
    document.body.append(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    current.primaryName = enteredName;
    current.approvedName = targetName;
    current.status = 'approved';
    renderFileList();
    renderCurrentRecord();
    setStatus(`Downloaded ${targetName}. The original file was not changed.`, 'success');
    return;
  }

  try {
    await renameInSelectedFolder(state.directoryHandle, sourceName, targetName);
  } catch (error) {
    console.warn('PDF rename failed:', error);
    setStatus(`Could not rename ${sourceName}. Check folder permissions and try again.`, 'danger');
    return;
  }

  current.file = new File([current.file], targetName, {
    type: current.file.type,
    lastModified: current.file.lastModified
  });
  current.primaryName = enteredName;
  current.approvedName = targetName;
  current.status = 'approved';
  state.renameHistory.push({
    oldName: sourceName,
    newName: targetName,
    primary: finalName,
    date: new Date().toISOString(),
    directoryHandle: state.directoryHandle,
    previousApprovedName,
    previousStatus
  });
  renderFileList();
  renderCurrentRecord();
  setStatus(`Renamed ${sourceName} to ${targetName}.`, 'success');
}

function skipCurrent() {
  const current = state.files[state.currentIndex];
  if (!current) return;
  current.status = 'skipped';
  renderFileList();
  renderCurrentRecord();
  setStatus('File skipped.', 'neutral');
}

function reviewLater() {
  const current = state.files[state.currentIndex];
  if (!current) return;
  current.status = 'needs-review';
  current.manualReview = true;
  renderFileList();
  renderCurrentRecord();
  setStatus('Moved to review queue.', 'warning');
}

async function undoLastRename() {
  if (!state.renameHistory.length) {
    setStatus('There is no rename to undo.', 'warning');
    return;
  }

  const lastAction = state.renameHistory[state.renameHistory.length - 1];
  const record = state.files.find((item) => item.file.name === lastAction.newName);
  if (!record) {
    setStatus('The renamed PDF is not in the current review list.', 'warning');
    return;
  }

  try {
    await renameInSelectedFolder(lastAction.directoryHandle, lastAction.newName, lastAction.oldName);
  } catch (error) {
    console.warn('Undo rename failed:', error);
    setStatus(`Could not restore ${lastAction.oldName}. Check folder permissions and try again.`, 'danger');
    return;
  }

  state.renameHistory.pop();
  record.file = new File([record.file], lastAction.oldName, {
    type: record.file.type,
    lastModified: record.file.lastModified
  });
  record.status = lastAction.previousStatus;
  record.approvedName = lastAction.previousApprovedName;
  renderFileList();
  renderCurrentRecord();
  setStatus(`Restored ${lastAction.newName} to ${lastAction.oldName}.`, 'neutral');
}

function setupEvents() {
  updateApprovalButtonLabel();
  dom.selectFolderBtn.addEventListener('click', selectFolderUsingPicker);
  dom.openPdfBtn.addEventListener('click', () => dom.pdfInput.click());
  dom.processBtn.addEventListener('click', async () => {
    if (!state.files.length) {
      setStatus('Select a folder before processing.', 'warning');
      return;
    }
    for (const record of state.files) {
      await analyzePdf(record);
    }
  });

  dom.folderInput.addEventListener('change', async (event) => {
    state.directoryHandle = null;
    updateApprovalButtonLabel();
    const files = [...event.target.files];
    setTimeout(() => {
      event.target.value = '';
    }, 0);
    if (!files.length) return;
    const pdfFiles = files.filter((file) => /\.pdf$/i.test(file.name));
    if (!pdfFiles.length) {
      setStatus('No PDF files were selected from the folder picker.', 'warning');
      return;
    }
    state.folderName = pdfFiles[0].webkitRelativePath ? pdfFiles[0].webkitRelativePath.split('/')[0] : 'Selected folder';
    dom.folderName.textContent = state.folderName;
    setStatus(`Processing ${pdfFiles.length} selected PDF files...`, 'warning');
    await processFolder(pdfFiles);
  });

  dom.pdfInput.addEventListener('change', async (event) => {
    state.directoryHandle = null;
    updateApprovalButtonLabel();
    const files = [...event.target.files];
    setTimeout(() => {
      event.target.value = '';
    }, 0);
    if (!files.length) return;
    const pdfFiles = files.filter((file) => /\.pdf$/i.test(file.name));
    if (!pdfFiles.length) {
      setStatus('No valid PDF files were selected.', 'warning');
      return;
    }
    if (pdfFiles.length === 1) {
      setStatus('Opening and processing selected PDF...', 'warning');
      await renderSelectedPdf(pdfFiles[0]);
      return;
    }
    setStatus(`Processing ${pdfFiles.length} selected PDF files...`, 'warning');
    await processFolder(pdfFiles);
  });

  dom.approveBtn.addEventListener('click', approveRename);
  dom.editNameBtn.addEventListener('click', handleManualRename);
  dom.skipBtn.addEventListener('click', skipCurrent);
  dom.reviewLaterBtn.addEventListener('click', reviewLater);
  dom.undoBtn.addEventListener('click', undoLastRename);

  dom.prevPageBtn.addEventListener('click', () => {
    const current = state.files[state.currentIndex];
    if (!current) return;
    const totalPages = current.pageCount || current.pageImages?.length || 1;
    currentPage = Math.max(1, currentPage - 1);
    if (currentPage > totalPages) currentPage = totalPages;
    renderCurrentRecord();
  });

  dom.nextPageBtn.addEventListener('click', () => {
    const current = state.files[state.currentIndex];
    if (!current) return;
    const totalPages = current.pageCount || current.pageImages?.length || 1;
    currentPage = Math.min(totalPages, currentPage + 1);
    renderCurrentRecord();
  });

  dom.zoomInBtn.addEventListener('click', () => {
    zoom = Math.min(2.5, Number((zoom + 0.15).toFixed(2)));
    renderCurrentRecord();
  });

  dom.zoomOutBtn.addEventListener('click', () => {
    zoom = Math.max(0.6, Number((zoom - 0.15).toFixed(2)));
    renderCurrentRecord();
  });

  dom.searchInput.addEventListener('input', renderFileList);
  dom.manualNameInput.addEventListener('input', () => {
    const current = state.files[state.currentIndex];
    if (current) current.primaryName = dom.manualNameInput.value;
  });
  dom.filterButtons.forEach((button) => {
    button.addEventListener('click', () => applyFilter(button.dataset.filter));
  });
}

setupEvents();
setStatus('Ready for document review.', 'neutral');
