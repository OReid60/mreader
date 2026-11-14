"""Create small synthetic manga fixtures using only Python's standard library."""
import json
from pathlib import Path
import struct
import zipfile
import zlib

root = Path(__file__).resolve().parent.parent / "test-artifacts"
root.mkdir(exist_ok=True)

def png(red, green, blue):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = (b"\0" + bytes([red, green, blue]) * 320) * 480
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 320, 480, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")

archive = root / "Reader validation.cbz"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as book:
    for index, color in enumerate([(65, 91, 160), (64, 148, 111), (188, 133, 56)], 1):
        book.writestr(f"page-{index}.png", png(*color))

text = b"BT /F1 22 Tf 50 720 Td (Mreader PDF validation) Tj ET\n"
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    b"<< /Length " + str(len(text)).encode() + b" >>\nstream\n" + text + b"endstream",
]
document = bytearray(b"%PDF-1.4\n")
offsets = [0]
for index, value in enumerate(objects, 1):
    offsets.append(len(document))
    document.extend(f"{index} 0 obj\n".encode() + value + b"\nendobj\n")
xref = len(document)
document.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
for offset in offsets[1:]:
    document.extend(f"{offset:010d} 00000 n \n".encode())
document.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
pdf = root / "Reader validation.pdf"
pdf.write_bytes(document)
print(json.dumps([str(archive), str(pdf)]))
