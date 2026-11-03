#!/usr/bin/env python3
"""Build the README GIF from real app captures. Requires Pillow, not an app dependency."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
WIDTH, SHOT_HEIGHT, HEADER, FOOTER = 1080, 750, 92, 96
DARK, PAPER, GOLD, INK = '#252e29', '#f7f6f0', '#efcf70', '#26302a'
STEPS = [
    ('01-dashboard.png', 'See what is ready to bill', 'Unbilled work, outstanding balances, and recent invoices in one place.'),
    ('02-time.png', 'Keep the work connected', 'Time belongs to a client and project, alongside line items and expenses.'),
    ('03-builder.png', 'Review before you bill', 'Select the work and check the live invoice preview.'),
    ('04-invoice.png', 'Create a clear invoice', 'Source work is linked to the invoice. Export a PDF when you are ready.'),
    ('05-ledger.png', 'Know where your billing stands', 'Review invoiced, paid, outstanding, and overdue totals.'),
    ('06-export.png', 'Take the selected records with you', 'Filter by invoice date and status, then export the same selection as CSV.'),
]


def build():
    title = ImageFont.load_default(size=28)
    label = ImageFont.load_default(size=17)
    small = ImageFont.load_default(size=15)
    frames = []
    for index, (name, heading, caption) in enumerate(STEPS):
        with Image.open(ROOT / 'docs/walkthrough' / name) as source:
            if source.size != (1440, 1000):
                raise ValueError(f'{name}: expected a 1440 x 1000 browser capture')
            shot = source.convert('RGB').resize((WIDTH, SHOT_HEIGHT), Image.Resampling.LANCZOS)
        canvas = Image.new('RGB', (WIDTH, HEADER + SHOT_HEIGHT + FOOTER), PAPER)
        draw = ImageDraw.Draw(canvas)
        draw.rectangle((0, 0, WIDTH, HEADER), fill=DARK)
        draw.text((28, 17), 'CW INVOICER', font=title, fill=GOLD)
        draw.text((28, 54), 'Your work. Your invoices. Your computer.', font=label, fill='white')
        draw.text((WIDTH - 280, 35), 'REAL APP / FICTIONAL DATA', font=small, fill='#d5ddd4')
        canvas.paste(shot, (0, HEADER))
        y = HEADER + SHOT_HEIGHT
        draw.text((28, y + 14), f'{index + 1:02d} / 06', font=label, fill='#786020')
        draw.text((126, y + 11), heading, font=title, fill=INK)
        draw.text((126, y + 49), caption, font=label, fill=INK)
        # A quiet four-second progress strip adds motion without flashing or panning text.
        for tick in range(4):
            frame = canvas.copy()
            progress = ImageDraw.Draw(frame)
            progress.rectangle((0, frame.height - 5, WIDTH, frame.height), fill='#deded4')
            progress.rectangle((0, frame.height - 5, int(WIDTH * (index * 4 + tick + 1) / 24), frame.height), fill='#9a7924')
            frames.append(frame.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    output = ROOT / 'docs/images/walkthrough.gif'
    frames[0].save(output, save_all=True, append_images=frames[1:], duration=1000, loop=0, optimize=True, disposal=1)
    print(f'{output.relative_to(ROOT)}: {output.stat().st_size:,} bytes, 24 seconds, {len(frames)} frames')


if __name__ == '__main__':
    build()
