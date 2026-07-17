#!/usr/bin/env python3
"""Generate printable ArUco marker cards for classroom voting (A5, PDF)."""

import argparse
import math
from pathlib import Path

import cv2
import numpy as np
from reportlab.lib.pagesizes import A5
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


ARUCO_DICT = cv2.aruco.DICT_6X6_50
MARKER_SIZE_PX = 400
CARD_LABELS = ["A", "B", "C", "D"]


def generate_marker_image(marker_id: int, size_px: int = MARKER_SIZE_PX) -> np.ndarray:
    aruco_dict = cv2.aruco.getPredefinedDictionary(ARUCO_DICT)
    marker = cv2.aruco.generateImageMarker(aruco_dict, marker_id, size_px)
    return marker


def build_card_image(marker_id: int) -> np.ndarray:
    """Build a single card: ArUco marker centered, A/B/C/D labels on edges, orientation dot at A."""
    marker = generate_marker_image(marker_id)
    h, w = marker.shape[:2]

    padding = 120
    label_margin = 60
    canvas_size = h + 2 * padding + 2 * label_margin
    card = np.ones((canvas_size, canvas_size), dtype=np.uint8) * 255

    ox = (canvas_size - w) // 2
    oy = (canvas_size - h) // 2
    card[oy : oy + h, ox : ox + w] = marker

    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 2.0
    thickness = 4
    color = 0

    positions = [
        ("A", (canvas_size // 2, oy - label_margin + 10)),
        ("B", (ox + w + label_margin - 10, canvas_size // 2)),
        ("C", (canvas_size // 2, oy + h + label_margin + 20)),
        ("D", (ox - label_margin + 10, canvas_size // 2)),
    ]

    for label, (cx, cy) in positions:
        (tw, th), _ = cv2.getTextSize(label, font, font_scale, thickness)
        cv2.putText(card, label, (cx - tw // 2, cy + th // 2), font, font_scale, color, thickness)

    # Orientation dot next to A (top) — filled circle so students know which side is "up"
    cv2.circle(card, (canvas_size // 2 + 50, oy - label_margin + 5), 12, 0, -1)

    # Student number in top-left corner
    id_text = f"#{marker_id}"
    cv2.putText(card, id_text, (15, 40), font, 1.0, 150, 2)

    return card


def generate_pdf(output_path: str, start_id: int, count: int):
    """Generate an A5 PDF with one card per page."""
    c = canvas.Canvas(output_path, pagesize=A5)
    page_w, page_h = A5

    for i in range(count):
        marker_id = start_id + i
        card_img = build_card_image(marker_id)

        tmp_path = Path(f"/tmp/aruco_card_{marker_id}.png")
        cv2.imwrite(str(tmp_path), card_img)

        margin = 15 * mm
        img_size = min(page_w, page_h) - 2 * margin
        x = (page_w - img_size) / 2
        y = (page_h - img_size) / 2

        c.drawImage(str(tmp_path), x, y, width=img_size, height=img_size)
        c.showPage()
        tmp_path.unlink()

    c.save()
    print(f"Generated {count} cards → {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate ArUco voting cards as PDF")
    parser.add_argument("-n", "--count", type=int, default=40, help="Number of cards (default: 40)")
    parser.add_argument("-s", "--start", type=int, default=1, help="Starting marker ID (default: 1)")
    parser.add_argument("-o", "--output", default="cards.pdf", help="Output PDF path (default: cards.pdf)")
    args = parser.parse_args()

    generate_pdf(args.output, args.start, args.count)


if __name__ == "__main__":
    main()
