/**
 * NeuroScan AI - Clinical MRI Diagnostic Suite
 * Frontend Application Controller - User Upload, Manual Predict Trigger & Direct PDF Export
 */

// Determine API Base URL automatically
const API_BASE_URL = window.location.protocol.startsWith('http') && window.location.port === '8000'
  ? window.location.origin
  : 'http://127.0.0.1:8000';

// DOM Elements
const backendStatusPill = document.getElementById('backendStatusPill');
const backendStatusText = document.getElementById('backendStatusText');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

const previewContainer = document.getElementById('previewContainer');
const previewImage = document.getElementById('previewImage');
const previewDimensions = document.getElementById('previewDimensions');
const previewSize = document.getElementById('previewSize');
const removeImageBtn = document.getElementById('removeImageBtn');

const predictBtn = document.getElementById('predictBtn');
const btnIcon = document.getElementById('btnIcon');
const btnSpinner = document.getElementById('btnSpinner');
const predictBtnText = document.getElementById('predictBtnText');

const scanCard = document.getElementById('scanCard');
const analyzingBanner = document.getElementById('analyzingBanner');

const errorAlert = document.getElementById('errorAlert');
const errorMessage = document.getElementById('errorMessage');

const placeholderState = document.getElementById('placeholderState');
const predictionReportDoc = document.getElementById('predictionReportDoc');
const reportHeaderActions = document.getElementById('reportHeaderActions');

const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const printReportBtn = document.getElementById('printReportBtn');
const downloadTxtBtn = document.getElementById('downloadTxtBtn');

// Report Fields
const reportIdVal = document.getElementById('reportIdVal');
const reportTimestampVal = document.getElementById('reportTimestampVal');
const reportFileNameVal = document.getElementById('reportFileNameVal');

const diagnosisBanner = document.getElementById('diagnosisBanner');
const diagnosisTitle = document.getElementById('diagnosisTitle');
const tumorBadge = document.getElementById('tumorBadge');

const findingClassVal = document.getElementById('findingClassVal');
const findingConfidenceVal = document.getElementById('findingConfidenceVal');
const findingTumorStatusVal = document.getElementById('findingTumorStatusVal');
const findingSeverityVal = document.getElementById('findingSeverityVal');
const reportScanThumb = document.getElementById('reportScanThumb');

const reportTableBody = document.getElementById('reportTableBody');
const clinicalDescription = document.getElementById('clinicalDescription');
const clinicalRecommendation = document.getElementById('clinicalRecommendation');

let currentFile = null;
let lastPredictionResult = null;

// ==========================================
// 1. Backend Health Check
// ==========================================
async function checkBackendHealth() {
  backendStatusPill.className = 'status-pill checking';
  backendStatusText.textContent = 'Checking server...';

  try {
    const res = await fetch(`${API_BASE_URL}/health`, { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      backendStatusPill.className = 'status-pill online';
      backendStatusText.textContent = `Online (${data.device.toUpperCase()})`;
      return true;
    }
    throw new Error('Non-200 response');
  } catch (err) {
    backendStatusPill.className = 'status-pill offline';
    backendStatusText.textContent = 'Backend Offline';
    return false;
  }
}

checkBackendHealth();
setInterval(checkBackendHealth, 30000);

// ==========================================
// 2. File Selection & Drag-and-Drop
// ==========================================
dropzone.addEventListener('click', () => fileInput.click());

['dragenter', 'dragover'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('drag-active');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('drag-active');
  });
});

dropzone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (dt.files && dt.files.length > 0) {
    handleSelectedFile(dt.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleSelectedFile(e.target.files[0]);
  }
});

/**
 * Handle selected file: preview image and enable predict button
 */
function handleSelectedFile(file) {
  hideError();

  if (!file.type.startsWith('image/')) {
    showError('Unsupported file format. Please upload a valid brain MRI scan image (PNG, JPEG, etc.).');
    return;
  }

  currentFile = file;

  // File size formatting
  const sizeKb = (file.size / 1024).toFixed(1);
  const sizeFormatted = file.size > 1024 * 1024
    ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
    : `${sizeKb} KB`;

  previewSize.textContent = sizeFormatted;

  // Preview Image
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImage.src = e.target.result;
    reportScanThumb.src = e.target.result;
    previewContainer.style.display = 'block';

    const img = new Image();
    img.src = e.target.result;
    img.onload = () => {
      previewDimensions.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
    };

    // Enable the predict button
    predictBtn.disabled = false;

    // Reset previous report state until user clicks predict
    placeholderState.style.display = 'block';
    predictionReportDoc.style.display = 'none';
    reportHeaderActions.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

removeImageBtn.addEventListener('click', () => {
  resetAll();
});

function resetAll() {
  currentFile = null;
  fileInput.value = '';
  previewContainer.style.display = 'none';
  previewImage.src = '';
  reportScanThumb.src = '';
  previewDimensions.textContent = '-- × --';
  previewSize.textContent = '-- KB';
  predictBtn.disabled = true;
  placeholderState.style.display = 'block';
  predictionReportDoc.style.display = 'none';
  reportHeaderActions.style.display = 'none';
  lastPredictionResult = null;
  hideError();
  setAnalyzingState(false);
}

// ==========================================
// 3. User Predict Action
// ==========================================
predictBtn.addEventListener('click', () => {
  if (!currentFile) {
    showError('Please upload a brain MRI scan image first.');
    return;
  }
  executePrediction(currentFile);
});

async function executePrediction(file) {
  hideError();
  setAnalyzingState(true);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(`${API_BASE_URL}/predict`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.detail || `Server error (${response.status})`);
    }

    const result = await response.json();
    lastPredictionResult = { ...result, fileName: file.name, timestamp: new Date() };
    renderPredictionReport(result, file);

  } catch (error) {
    console.error('Prediction error:', error);
    showError(`Prediction failed: ${error.message}. Ensure backend is running.`);
    placeholderState.style.display = 'block';
    predictionReportDoc.style.display = 'none';
    reportHeaderActions.style.display = 'none';
  } finally {
    setAnalyzingState(false);
  }
}

function setAnalyzingState(isAnalyzing) {
  if (isAnalyzing) {
    predictBtn.disabled = true;
    btnSpinner.style.display = 'inline-block';
    btnIcon.style.display = 'none';
    predictBtnText.textContent = 'Predicting...';
    scanCard.classList.add('scanning');
    analyzingBanner.style.display = 'flex';
  } else {
    predictBtn.disabled = !currentFile;
    btnSpinner.style.display = 'none';
    btnIcon.style.display = 'inline-block';
    predictBtnText.textContent = 'Predict Disease & Generate Report';
    scanCard.classList.remove('scanning');
    analyzingBanner.style.display = 'none';
  }
}

// ==========================================
// 4. Formal Prediction Report Rendering
// ==========================================
const CLASS_LABELS = {
  glioma: 'Glioma (Brain Tumor)',
  meningioma: 'Meningioma (Brain Tumor)',
  pituitary: 'Pituitary Adenoma (Tumor)',
  notumor: 'Normal Tissue (No Tumor Detected)'
};

function renderPredictionReport(data, file) {
  placeholderState.style.display = 'none';
  predictionReportDoc.style.display = 'block';
  reportHeaderActions.style.display = 'flex';

  const profile = data.clinical_profile;
  const isTumor = data.is_tumor;
  const topConfidence = (data.confidence * 100).toFixed(2);

  // Metadata
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  reportIdVal.textContent = `REP-${dateStr}-${randomSuffix}`;
  reportTimestampVal.textContent = now.toLocaleString();
  reportFileNameVal.textContent = file.name || 'brain_scan.png';

  // Primary Diagnosis Banner
  diagnosisBanner.className = `diagnosis-banner severity-${profile.severity || (isTumor ? 'high' : 'normal')}`;
  diagnosisTitle.textContent = profile.title || CLASS_LABELS[data.prediction] || data.prediction;

  if (isTumor) {
    tumorBadge.className = 'diagnosis-badge badge-tumor';
    tumorBadge.innerHTML = `
      <svg style="width:16px;height:16px;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      Tumor Detected
    `;
    findingTumorStatusVal.textContent = 'POSITIVE';
    findingTumorStatusVal.style.color = 'var(--rose-600)';
  } else {
    tumorBadge.className = 'diagnosis-badge badge-clear';
    tumorBadge.innerHTML = `
      <svg style="width:16px;height:16px;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      No Tumor Detected
    `;
    findingTumorStatusVal.textContent = 'NEGATIVE';
    findingTumorStatusVal.style.color = 'var(--emerald-600)';
  }

  // Findings Summary Grid
  findingClassVal.textContent = data.prediction.toUpperCase();
  findingConfidenceVal.textContent = `${topConfidence}%`;
  findingSeverityVal.textContent = (profile.severity || 'moderate').toUpperCase();

  // Probability Breakdown Table
  reportTableBody.innerHTML = '';
  const probabilities = data.probabilities || { [data.prediction]: data.confidence };
  const classKeys = ['glioma', 'meningioma', 'pituitary', 'notumor'];

  classKeys.forEach((key) => {
    const probVal = probabilities[key] !== undefined ? probabilities[key] : 0;
    const percentage = (probVal * 100).toFixed(2);
    const isTop = key === data.prediction;
    const isClassTumor = key !== 'notumor';

    const tr = document.createElement('tr');
    if (isTop) {
      tr.className = `top-row ${isClassTumor ? 'tumor' : 'normal'}`;
    }

    tr.innerHTML = `
      <td>
        <strong>${CLASS_LABELS[key] || key}</strong>
        ${isTop ? ' <span style="font-size:0.72rem; background:rgba(37,99,235,0.12); color:var(--primary); padding:2px 6px; border-radius:4px; font-weight:700;">TOP FINDING</span>' : ''}
      </td>
      <td><strong>${percentage}%</strong></td>
      <td>
        <div class="table-prob-bar-track">
          <div class="table-prob-bar-fill" style="width: ${percentage}%"></div>
        </div>
      </td>
    `;
    reportTableBody.appendChild(tr);
  });

  // Clinical Overview & Guidance
  clinicalDescription.textContent = profile.description || 'Neural pathology evaluation completed.';
  clinicalRecommendation.textContent = profile.recommendation || 'Consultation with neurologist / neurosurgeon advised.';
}

// ==========================================
// 5. Professional PDF Generation & Download
// ==========================================
downloadPdfBtn.addEventListener('click', async () => {
  if (!predictionReportDoc || predictionReportDoc.style.display === 'none') {
    showError('No active prediction report to export.');
    return;
  }

  const originalBtnHtml = downloadPdfBtn.innerHTML;
  downloadPdfBtn.disabled = true;
  downloadPdfBtn.innerHTML = `
    <span class="spinner-blue" style="width:12px;height:12px;border-color:rgba(255,255,255,0.4);border-top-color:white;border-width:2px;display:inline-block;"></span>
    Generating PDF...
  `;

  const reportId = reportIdVal.textContent || 'REPORT';
  const filename = `Brain_MRI_Prediction_Report_${reportId}.pdf`;

  try {
    if (typeof html2pdf !== 'undefined') {
      const opt = {
        margin: [8, 8, 8, 8],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().set(opt).from(predictionReportDoc).save();
    } else {
      window.print();
    }
  } catch (error) {
    console.error('PDF generation error:', error);
    showError(`PDF generation encountered an error: ${error.message}. Opening system print dialog as fallback.`);
    window.print();
  } finally {
    downloadPdfBtn.disabled = false;
    downloadPdfBtn.innerHTML = originalBtnHtml;
  }
});

// Print: Invokes print with CSS media print styling (Clean 1-page report)
printReportBtn.addEventListener('click', () => {
  window.print();
});

// Download clean text prediction report
downloadTxtBtn.addEventListener('click', () => {
  if (!lastPredictionResult) return;

  const data = lastPredictionResult;
  const profile = data.clinical_profile || {};
  const isTumor = data.is_tumor;
  const probs = data.probabilities || {};

  const textReport = `================================================================================
                    NEUROSCAN CLINICAL DIAGNOSTICS
                  BRAIN MRI TUMOR PREDICTION REPORT
================================================================================
Report ID:        ${reportIdVal.textContent}
Date & Time:      ${reportTimestampVal.textContent}
Scan File:        ${reportFileNameVal.textContent}
Modality:         Brain MRI (Axial Slice)
AI Model:         PyTorch CNN 4-Class Diagnostic Classifier v2.0
System Status:    VERIFIED INFERRED
--------------------------------------------------------------------------------
1. PRIMARY DIAGNOSTIC FINDING
--------------------------------------------------------------------------------
Classification:   ${(profile.title || data.prediction).toUpperCase()}
Confidence Score: ${(data.confidence * 100).toFixed(2)}%
Tumor Status:     ${isTumor ? 'POSITIVE (Tumor Detected)' : 'NEGATIVE (No Tumor Detected)'}
Clinical Severity:${(profile.severity || 'Moderate').toUpperCase()}

--------------------------------------------------------------------------------
2. CLASS PROBABILITY DISTRIBUTION (SOFTMAX NORMALIZED)
--------------------------------------------------------------------------------
- Glioma:                 ${((probs.glioma || 0) * 100).toFixed(2)}%
- Meningioma:             ${((probs.meningioma || 0) * 100).toFixed(2)}%
- Pituitary Tumor:        ${((probs.pituitary || 0) * 100).toFixed(2)}%
- No Tumor (Normal):      ${((probs.notumor || 0) * 100).toFixed(2)}%

--------------------------------------------------------------------------------
3. CLINICAL ASSESSMENT & RECOMMENDATIONS
--------------------------------------------------------------------------------
Pathology Summary:
${profile.description || 'Deep neural network analysis completed.'}

Recommended Actions:
${profile.recommendation || 'Clinical review recommended.'}

================================================================================
NOTICE: This report is generated by a deep-learning decision support model for
clinical evaluation and triage. Final diagnostic confirmation requires review
by a licensed physician or board-certified radiologist.
================================================================================`;

  const blob = new Blob([textReport], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Brain_MRI_Prediction_Report_${reportIdVal.textContent}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ==========================================
// 6. Error Helpers
// ==========================================
function showError(msg) {
  errorMessage.textContent = msg;
  errorAlert.style.display = 'flex';
}

function hideError() {
  errorAlert.style.display = 'none';
}
