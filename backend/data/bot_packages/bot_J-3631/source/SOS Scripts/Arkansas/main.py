import csv
from pathlib import Path

if __name__ == '__main__':
    input_lines = [line.strip() for line in Path('Input.txt').read_text(encoding='utf-8').splitlines() if line.strip()]
    with Path('Output.csv').open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=['keyword'])
        writer.writeheader()
        for value in input_lines:
            writer.writerow({'keyword': value})
