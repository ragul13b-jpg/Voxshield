"""
VoxShield evaluation framework.

Runs the real analysis pipeline (the same code path as the API - not a
separate/simplified copy) over a directory of audio files and reports
actual measured behavior: processing time, risk distribution, and - only
when ground-truth labels are provided - precision/recall/F1/confusion
matrix. It never fabricates a metric it can't actually compute.

Usage:
    python -m app.evaluation.evaluate --dataset ./evaluation_data
    python -m app.evaluation.evaluate --dataset ./evaluation_data --out report.json

Dataset format:
    A directory of .wav files, optionally with a `labels.csv` in the same
    directory containing columns: filename,label,category
      - label: "genuine" | "spoof" | "unlabeled" (anything else is treated
        as unlabeled - excluded from precision/recall/F1)
      - category: a free-text grouping (e.g. "clean", "noisy", "hindi") used
        to break down results by condition

Predicted label mapping (stated explicitly, not hidden): a sample is
treated as a "spoof" prediction if risk_level == "HIGH", and "genuine"
otherwise (LOW or SUSPICIOUS). This threshold is a simplification for
computing a single confusion matrix - the underlying trust_score is
continuous, see the raw per-sample results for the actual scores.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

# Allow running as `python -m app.evaluation.evaluate` from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from app.services import db  # noqa: E402
from app.services.analysis_service import run_full_analysis  # noqa: E402

MIN_SAMPLES_FOR_BENCHMARK = 30  # below this, precision/recall/F1 are not reported as meaningful


def load_labels(dataset_dir: Path) -> dict[str, dict]:
    labels_path = dataset_dir / "labels.csv"
    labels: dict[str, dict] = {}
    if labels_path.exists():
        with open(labels_path, newline="") as f:
            for row in csv.DictReader(f):
                labels[row["filename"]] = {
                    "label": (row.get("label") or "unlabeled").strip().lower(),
                    "category": (row.get("category") or "unspecified").strip(),
                }
    return labels


def run_evaluation(dataset_dir: Path) -> dict:
    labels = load_labels(dataset_dir)
    audio_files = sorted(
        [p for p in dataset_dir.iterdir() if p.suffix.lower() in (".wav", ".flac", ".mp3", ".ogg")]
    )

    results = []
    errors = []

    for path in audio_files:
        meta = labels.get(path.name, {"label": "unlabeled", "category": "unspecified"})
        start = time.perf_counter()
        try:
            audio_bytes = path.read_bytes()
            record = run_full_analysis(audio_bytes, source="evaluation", source_label=path.name)
            elapsed = time.perf_counter() - start
            results.append(
                {
                    "filename": path.name,
                    "label": meta["label"],
                    "category": meta["category"],
                    "trust_score": record["trust_score"],
                    "risk_score": record["risk_score"],
                    "risk_level": record["risk_level"],
                    "predicted_spoof": record["risk_level"] == "HIGH",
                    "processing_time_seconds": round(elapsed, 3),
                    "transcription_available": record["transcription"]["available"],
                    "ai_deepfake_available": record["ai_deepfake"]["available"],
                    "ai_deepfake_synthetic_probability": record["ai_deepfake"]["synthetic_probability"],
                    "speaker_consistency_available": record["speaker_consistency"] is not None,
                }
            )
        except Exception as exc:  # noqa: BLE001 - we want to record every failure, not stop the run
            elapsed = time.perf_counter() - start
            errors.append({"filename": path.name, "error": f"{type(exc).__name__}: {exc}", "processing_time_seconds": round(elapsed, 3)})

    return _build_report(dataset_dir, results, errors)


def _build_report(dataset_dir: Path, results: list[dict], errors: list[dict]) -> dict:
    n_total = len(results) + len(errors)
    n_success = len(results)

    report: dict = {
        "dataset": str(dataset_dir),
        "num_samples": n_total,
        "num_processed_successfully": n_success,
        "num_errors": len(errors),
        "processing_success_rate": round(n_success / n_total, 4) if n_total else None,
        "errors": errors,
    }

    if not results:
        report["note"] = "No samples processed successfully - no further metrics available."
        return report

    times = [r["processing_time_seconds"] for r in results]
    report["average_processing_time_seconds"] = round(sum(times) / len(times), 3)
    report["max_processing_time_seconds"] = round(max(times), 3)
    report["min_processing_time_seconds"] = round(min(times), 3)

    risk_levels = {}
    for r in results:
        risk_levels[r["risk_level"]] = risk_levels.get(r["risk_level"], 0) + 1
    report["risk_level_distribution"] = risk_levels

    report["ai_deepfake_availability_rate"] = round(
        sum(1 for r in results if r["ai_deepfake_available"]) / len(results), 4
    )
    report["transcription_availability_rate"] = round(
        sum(1 for r in results if r["transcription_available"]) / len(results), 4
    )

    # Category breakdown (always safe to report - just a count/avg-score group-by)
    categories: dict[str, list[dict]] = {}
    for r in results:
        categories.setdefault(r["category"], []).append(r)
    report["by_category"] = {
        cat: {
            "count": len(items),
            "average_trust_score": round(sum(i["trust_score"] for i in items) / len(items), 1),
        }
        for cat, items in categories.items()
    }

    # Ground-truth metrics - ONLY computed when explicit genuine/spoof labels exist
    labeled = [r for r in results if r["label"] in ("genuine", "spoof")]
    report["num_labeled_samples"] = len(labeled)

    if len(labeled) < MIN_SAMPLES_FOR_BENCHMARK:
        report["ground_truth_metrics"] = None
        report["ground_truth_metrics_note"] = (
            f"Evaluation dataset insufficient for a statistically meaningful benchmark "
            f"({len(labeled)} labeled sample(s); {MIN_SAMPLES_FOR_BENCHMARK}+ recommended). "
            f"Confusion matrix and precision/recall/F1 are not reported to avoid implying "
            f"a reliability level this sample size cannot support."
        )
        # Still show the raw labeled outcomes - useful for a sanity check even if not a benchmark
        report["labeled_sample_outcomes"] = [
            {"filename": r["filename"], "true_label": r["label"], "predicted_spoof": r["predicted_spoof"],
             "trust_score": r["trust_score"]}
            for r in labeled
        ]
    else:
        report["ground_truth_metrics"] = _compute_metrics(labeled)

    report["raw_results"] = results
    return report


def _compute_metrics(labeled: list[dict]) -> dict:
    tp = sum(1 for r in labeled if r["label"] == "spoof" and r["predicted_spoof"])
    fn = sum(1 for r in labeled if r["label"] == "spoof" and not r["predicted_spoof"])
    fp = sum(1 for r in labeled if r["label"] == "genuine" and r["predicted_spoof"])
    tn = sum(1 for r in labeled if r["label"] == "genuine" and not r["predicted_spoof"])

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    accuracy = (tp + tn) / len(labeled) if labeled else 0.0

    return {
        "confusion_matrix": {"true_positive_spoof": tp, "false_negative": fn, "false_positive": fp, "true_negative_genuine": tn},
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "accuracy": round(accuracy, 4),
        "predicted_label_rule": "predicted_spoof = (risk_level == 'HIGH')",
    }


def write_csv(report: dict, path: Path) -> None:
    rows = report.get("raw_results", [])
    if not rows:
        return
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description="VoxShield evaluation framework")
    parser.add_argument("--dataset", required=True, help="Directory of audio files (optionally with labels.csv)")
    parser.add_argument("--out", default=None, help="Output JSON report path (default: <dataset>/evaluation_report.json)")
    parser.add_argument("--csv", default=None, help="Also write per-sample results as CSV")
    args = parser.parse_args()

    dataset_dir = Path(args.dataset)
    if not dataset_dir.is_dir():
        print(f"Dataset directory not found: {dataset_dir}", file=sys.stderr)
        sys.exit(1)

    db.init_db()
    report = run_evaluation(dataset_dir)

    out_path = Path(args.out) if args.out else dataset_dir / "evaluation_report.json"
    out_path.write_text(json.dumps(report, indent=2))
    print(f"Report written to {out_path}")

    if args.csv:
        write_csv(report, Path(args.csv))
        print(f"Per-sample CSV written to {args.csv}")

    print("\n--- Summary ---")
    print(f"Samples: {report['num_samples']} (processed OK: {report['num_processed_successfully']}, errors: {report['num_errors']})")
    if report.get("average_processing_time_seconds") is not None:
        print(f"Avg processing time: {report['average_processing_time_seconds']}s")
    print(f"Risk level distribution: {report.get('risk_level_distribution')}")
    if report.get("ground_truth_metrics"):
        print(f"Ground-truth metrics: {report['ground_truth_metrics']}")
    else:
        print(f"Ground-truth metrics: {report.get('ground_truth_metrics_note')}")


if __name__ == "__main__":
    main()
