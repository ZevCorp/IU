#!/usr/bin/env python3
"""
YOLO UI Element Detection for ScreenAgent SoM pipeline.
Takes a screenshot image, runs YOLOv11l UI detection, outputs JSON with bounding boxes.

Usage:
    python3 yolo_detect.py /path/to/screenshot.png [--confidence 0.3] [--som /path/to/output_som.png]

Output (stdout JSON):
    {
        "elements": [
            {
                "id": 1,
                "label": "AXButton",
                "confidence": 0.87,
                "bbox": {"x1": 100, "y1": 200, "x2": 250, "y2": 230},
                "center": {"x": 175, "y": 215},
                "center_norm": {"x": 0.121, "y": 0.239}
            },
            ...
        ],
        "image_size": {"width": 1440, "height": 900},
        "som_image": "/path/to/output_som.png"  // only if --som flag used
    }
"""

import sys
import json
import os
import argparse
from pathlib import Path

# Download model on first run
MODEL_REPO = "macpaw-research/yolov11l-ui-elements-detection"
MODEL_FILE = "ui-elements-detection.pt"
MODEL_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".yolo_model_cache")


def get_model_path():
    """Download and cache the YOLO model."""
    cached = os.path.join(MODEL_CACHE, MODEL_FILE)
    if os.path.exists(cached):
        return cached

    print("📥 Downloading YOLO UI detection model (first run)...", file=sys.stderr)
    from huggingface_hub import hf_hub_download
    path = hf_hub_download(
        repo_id=MODEL_REPO,
        filename=MODEL_FILE,
        cache_dir=MODEL_CACHE,
        local_dir=MODEL_CACHE,
    )
    print(f"✅ Model downloaded to {path}", file=sys.stderr)
    return path


def draw_som_overlay(image_path, elements, output_path):
    """Draw numbered SoM (Set-of-Mark) overlay on the image."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(img)

    # Try to get a readable font
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
        font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 11)
    except Exception:
        font = ImageFont.load_default()
        font_small = font

    colors = [
        "#FF4444", "#44FF44", "#4444FF", "#FFFF44", "#FF44FF",
        "#44FFFF", "#FF8844", "#88FF44", "#4488FF", "#FF4488",
    ]

    for elem in elements:
        idx = elem["id"]
        bbox = elem["bbox"]
        color = colors[idx % len(colors)]
        x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]

        # Draw bounding box
        draw.rectangle([x1, y1, x2, y2], outline=color, width=2)

        # Draw label background + number
        label = f"#{idx} {elem['label']}"
        text_bbox = draw.textbbox((0, 0), label, font=font_small)
        tw, th = text_bbox[2] - text_bbox[0], text_bbox[3] - text_bbox[1]
        label_y = max(0, y1 - th - 4)
        draw.rectangle([x1, label_y, x1 + tw + 6, label_y + th + 4], fill=color)
        draw.text((x1 + 3, label_y + 2), label, fill="white", font=font_small)

    img.save(output_path)
    return output_path


def detect(image_path, confidence=0.3, som_output=None):
    """Run YOLO detection on the image and return structured results."""
    from ultralytics import YOLO
    from PIL import Image

    model_path = get_model_path()
    model = YOLO(model_path)

    # Get image dimensions
    img = Image.open(image_path)
    img_w, img_h = img.size

    # Run prediction
    results = model.predict(
        source=image_path,
        conf=confidence,
        verbose=False,
    )

    elements = []
    if results and len(results) > 0:
        result = results[0]
        boxes = result.boxes

        for i, box in enumerate(boxes):
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            label = result.names[cls_id]

            cx = (x1 + x2) / 2
            cy = (y1 + y2) / 2

            elements.append({
                "id": i + 1,
                "label": label,
                "confidence": round(conf, 3),
                "bbox": {
                    "x1": round(x1),
                    "y1": round(y1),
                    "x2": round(x2),
                    "y2": round(y2),
                },
                "center": {
                    "x": round(cx),
                    "y": round(cy),
                },
                "center_norm": {
                    "x": round(cx / img_w, 4),
                    "y": round(cy / img_h, 4),
                },
            })

    # Sort by position (top-to-bottom, left-to-right)
    elements.sort(key=lambda e: (e["bbox"]["y1"], e["bbox"]["x1"]))
    # Re-assign IDs after sorting
    for i, elem in enumerate(elements):
        elem["id"] = i + 1

    output = {
        "elements": elements,
        "image_size": {"width": img_w, "height": img_h},
    }

    # Generate SoM overlay if requested
    if som_output:
        draw_som_overlay(image_path, elements, som_output)
        output["som_image"] = som_output

    return output


def main():
    parser = argparse.ArgumentParser(description="YOLO UI Element Detection")
    parser.add_argument("image", help="Path to screenshot image")
    parser.add_argument("--confidence", type=float, default=0.3, help="Confidence threshold (0-1)")
    parser.add_argument("--som", help="Path to save SoM overlay image")
    args = parser.parse_args()

    if not os.path.exists(args.image):
        print(json.dumps({"error": f"Image not found: {args.image}"}))
        sys.exit(1)

    result = detect(args.image, confidence=args.confidence, som_output=args.som)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
