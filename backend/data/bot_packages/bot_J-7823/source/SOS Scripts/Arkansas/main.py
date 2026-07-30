import json
from pathlib import Path

if __name__ == '__main__':
    input_lines = [line.strip() for line in Path('Input.txt').read_text(encoding='utf-8').splitlines() if line.strip()]
    print(json.dumps({
        'records': [{'keyword': value} for value in input_lines],
        'execution_metadata': {'mode': 'script', 'input_count': len(input_lines)},
    }))
