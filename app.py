import os
from pathlib import Path
from typing import Dict, Any

import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as transforms
from PIL import Image, UnidentifiedImageError
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# ==========================================
# Neural Network Architecture
# ==========================================
class Net(nn.Module):
    def __init__(self):
        super(Net, self).__init__()
        self.conv1 = nn.Conv2d(3, 6, 5)
        self.pool = nn.MaxPool2d(2, 2)
        self.conv2 = nn.Conv2d(6, 16, 5)
        self._to_linear = None
        self.convs(torch.randn(1, 3, 224, 224))
        self.fc1 = nn.Linear(self._to_linear, 120)
        self.fc2 = nn.Linear(120, 84)
        self.fc3 = nn.Linear(84, 4)

    def convs(self, x):
        x = self.pool(F.relu(self.conv1(x)))
        x = self.pool(F.relu(self.conv2(x)))
        if self._to_linear is None:
            self._to_linear = x.view(-1).shape[0]
        return x

    def forward(self, x):
        x = self.convs(x)
        x = x.view(x.size(0), -1)
        x = F.relu(self.fc1(x))
        x = F.relu(self.fc2(x))
        x = self.fc3(x)
        return x

# ==========================================
# Diagnostic Metadata & Medical Descriptions
# ==========================================
CLASSES = ['glioma', 'meningioma', 'notumor', 'pituitary']

CLINICAL_PROFILES = {
    "glioma": {
        "title": "Glioma Detected",
        "description": "Gliomas originate in the glial support cells of the central nervous system. They vary from low to high grade (e.g., glioblastoma) and can infiltrate surrounding brain tissue.",
        "recommendation": "Prompt neuro-oncological evaluation, contrast-enhanced 3T MRI, and multidisciplinary tumor board review recommended.",
        "severity": "high",
        "is_tumor": True
    },
    "meningioma": {
        "title": "Meningioma Detected",
        "description": "Meningiomas arise from the arachnoid cells of the meninges surrounding the brain. They are predominantly benign (Grade I) and slow-growing, though mass effect may occur.",
        "recommendation": "Neurosurgical consultation recommended to evaluate tumor volume, peritumoral edema, and determine if observation or resection is appropriate.",
        "severity": "moderate",
        "is_tumor": True
    },
    "pituitary": {
        "title": "Pituitary Tumor Detected",
        "description": "Pituitary adenomas arise in the sella turcica. They can be secretory (causing hyperprolactinemia, Cushing's, etc.) or non-secretory, potentially compressing the optic chiasm.",
        "recommendation": "Endocrinological workup (hormone panel) and automated perimetry visual field testing advised alongside neurosurgical assessment.",
        "severity": "moderate",
        "is_tumor": True
    },
    "notumor": {
        "title": "Normal Scan (No Tumor Detected)",
        "description": "The submitted MRI slice demonstrates no apparent intracranial neoplasm, mass lesion, or midline shift within the trained model's diagnostic parameters.",
        "recommendation": "Routine clinical correlation recommended. Re-evaluate if symptoms persist or new clinical indications arise.",
        "severity": "normal",
        "is_tumor": False
    }
}

# ==========================================
# Model Loading & Image Preprocessing
# ==========================================
BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model.pth"

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

net = Net().to(device)
if not MODEL_PATH.exists():
    raise FileNotFoundError(f"Model checkpoint not found at: {MODEL_PATH}")

net.load_state_dict(torch.load(MODEL_PATH, map_location=device))
net.eval()

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5])
])

def predict_image(image_file) -> Dict[str, Any]:
    try:
        image = Image.open(image_file).convert("RGB")
    except UnidentifiedImageError:
        raise HTTPException(status_code=400, detail="Invalid image format. Please upload a valid MRI image (JPEG, PNG, etc.).")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process image: {str(e)}")

    tensor = transform(image).unsqueeze(0).to(device)

    with torch.no_grad():
        outputs = net(tensor)
        probs = torch.softmax(outputs, dim=1)[0]
        predicted_idx = torch.argmax(probs).item()

    prediction_class = CLASSES[predicted_idx]
    top_confidence = round(probs[predicted_idx].item(), 4)

    # Detailed probability map
    probability_distribution = {
        cls_name: round(probs[idx].item(), 4)
        for idx, cls_name in enumerate(CLASSES)
    }

    profile = CLINICAL_PROFILES.get(prediction_class, {
        "title": prediction_class.capitalize(),
        "description": "Pathology analysis completed.",
        "recommendation": "Clinical correlation recommended.",
        "severity": "moderate",
        "is_tumor": prediction_class != "notumor"
    })

    return {
        "prediction": prediction_class,
        "confidence": top_confidence,
        "confidence_percentage": round(top_confidence * 100, 2),
        "is_tumor": profile["is_tumor"],
        "probabilities": probability_distribution,
        "clinical_profile": profile
    }

# ==========================================
# FastAPI Application Setup
# ==========================================
app = FastAPI(
    title="NeuroScan AI - Brain Tumor Diagnostic API",
    description="High-performance deep learning inference API for brain tumor detection and classification from MRI scans.",
    version="2.0.0"
)

# Enable CORS for cross-origin frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# API Endpoints
# ==========================================
@app.get("/health", tags=["System"])
async def health_check():
    """Verify backend system status and loaded deep learning model."""
    return {
        "status": "healthy",
        "device": str(device),
        "model_loaded": True,
        "classes": CLASSES,
        "version": "2.0.0"
    }

@app.post("/predict", tags=["Inference"])
async def predict(file: UploadFile = File(...)):
    """Upload an MRI image slice to receive tumor classification and probability distribution."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file is not an image.")
    return predict_image(file.file)

@app.get("/sample", tags=["Demo"])
async def get_sample_image():
    """Returns sample MRI image for quick demonstration."""
    sample_file = BASE_DIR / "sample.png"
    if sample_file.exists():
        return FileResponse(sample_file, media_type="image/png", filename="sample_mri.png")
    raise HTTPException(status_code=404, detail="Sample image not found on server.")

# ==========================================
# Serve Frontend Assets if Available
# ==========================================
frontend_dir = BASE_DIR / "frontend"
if frontend_dir.exists() and (frontend_dir / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")

# ==========================================
# Entrypoint
# ==========================================
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)