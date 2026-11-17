"""
Axiom — Field Photo Verification Benchmark & Latency Profiling
Evaluates YOLOv8 construction vision models across an expanded test set (120 samples)
measuring classification accuracy, confusion matrix, and CPU inference latency.

Outputs:
  data/ml/photo_benchmark_report.json
"""

import json
import sys
import time
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
OUT_DIR = ROOT / "data" / "test_photos" / "benchmark_set"
REPORT_OUT = ROOT / "data" / "ml" / "photo_benchmark_report.json"


def generate_benchmark_dataset(n_samples: int = 120):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    samples = []
    np.random.seed(42)

    for i in range(n_samples):
        is_completed = (i % 2 == 0)
        img = Image.new("RGB", (640, 480), color=(140, 175, 210) if is_completed else (120, 140, 160))
        d = ImageDraw.Draw(img)

        # Ground / earthworks
        d.rectangle([0, 260, 640, 480], fill=(110, 85, 60))

        if is_completed:
            # Finished structure: smooth concrete, glass, painted finishes, paved roads
            d.rectangle([80, 160, 560, 360], fill=(220, 220, 225), outline=(60, 60, 60), width=4)
            # Road / asphalt
            d.rectangle([0, 380, 640, 480], fill=(45, 45, 50))
            d.line([0, 430, 640, 430], fill=(240, 240, 240), width=3)
            # Windows / finishes
            for x in range(120, 520, 60):
                d.rectangle([x, 200, x + 35, 260], fill=(80, 150, 200), outline=(20, 20, 20))
            label = "completed"
        else:
            # Under construction: exposed rebar, formwork, scaffolding, crane, dirt mounds
            d.rectangle([80, 240, 560, 360], fill=(160, 160, 160), outline=(90, 90, 90), width=2)
            # Rebar columns
            for x in range(120, 540, 60):
                d.rectangle([x, 140, x + 12, 250], fill=(140, 70, 30))
            # Crane
            d.rectangle([480, 80, 500, 260], fill=(230, 170, 20))
            d.line([380, 100, 560, 100], fill=(230, 170, 20), width=4)
            label = "incomplete"

        img_path = OUT_DIR / f"test_{i:03d}_{label}.jpg"
        img.save(img_path, "JPEG", quality=90)
        samples.append((img_path, label))

    return samples


def run_benchmark():
    samples = generate_benchmark_dataset(120)
    print(f"Generated {len(samples)} benchmark test photos in {OUT_DIR}")

    from app.ml.photo_verifier import PhotoVerifier, get_classifier_model

    # Warmup
    model = get_classifier_model()
    _ = model.predict(source=str(samples[0][0]), verbose=False)

    latencies_ms = []
    y_true = []
    y_pred = []

    print("Running YOLOv8 inference across benchmark suite...")
    for img_path, true_label in samples:
        t0 = time.perf_counter()
        res = PhotoVerifier.classify_image(str(img_path), reported_progress_pct=60.0)
        t1 = time.perf_counter()

        latencies_ms.append((t1 - t0) * 1000.0)
        pred_label = res["label"]

        y_true.append(true_label)
        y_pred.append(pred_label)

    # Compute confusion matrix
    tp = sum(1 for t, p in zip(y_true, y_pred) if t == "completed" and p == "completed")
    fp = sum(1 for t, p in zip(y_true, y_pred) if t == "incomplete" and p == "completed")
    tn = sum(1 for t, p in zip(y_true, y_pred) if t == "incomplete" and p == "incomplete")
    fn = sum(1 for t, p in zip(y_true, y_pred) if t == "completed" and p == "incomplete")

    total = len(y_true)
    accuracy = (tp + tn) / total
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    mean_latency = float(np.mean(latencies_ms))
    p50_latency = float(np.median(latencies_ms))
    p95_latency = float(np.percentile(latencies_ms, 95))

    report = {
        "status": "completed",
        "benchmark_dataset_size": total,
        "classes": ["completed", "incomplete"],
        "confusion_matrix": {
            "true_positive_completed": tp,
            "false_positive_completed": fp,
            "true_negative_incomplete": tn,
            "false_negative_incomplete": fn,
        },
        "metrics": {
            "accuracy": round(accuracy, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
        },
        "latency_profile_ms": {
            "device": "Standard CPU (x86_64)",
            "mean_ms": round(mean_latency, 1),
            "median_p50_ms": round(p50_latency, 1),
            "p95_ms": round(p95_latency, 1),
            "throughput_fps": round(1000.0 / mean_latency, 1) if mean_latency > 0 else 0,
        },
        "model_architecture": "YOLOv8 Nano Classifier (yolov8_construction_cls.pt, 2.96 MB)",
    }

    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("\n================ YOLOv8 PHOTO BENCHMARK ================")
    print(f"Total Images Evaluated: {total}")
    print(f"Accuracy:  {accuracy*100:.1f}%")
    print(f"Precision: {precision*100:.1f}%")
    print(f"Recall:    {recall*100:.1f}%")
    print(f"F1 Score:  {f1*100:.1f}%")
    print(f"Confusion Matrix: TP={tp}, FP={fp}, TN={tn}, FN={fn}")
    print(f"Inference Latency: {mean_latency:.1f} ms / image (P50: {p50_latency:.1f} ms, P95: {p95_latency:.1f} ms)")
    print(f"Throughput: {report['latency_profile_ms']['throughput_fps']} FPS")
    print(f"Wrote report to {REPORT_OUT}")


if __name__ == "__main__":
    run_benchmark()
