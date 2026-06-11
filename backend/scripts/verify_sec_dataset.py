import os
import pandas as pd
import numpy as np

base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
csv_path = os.path.join(base_dir, "sample_sec.csv")

if not os.path.exists(csv_path):
    print(f"Error: {csv_path} does not exist.")
    exit(1)

df = pd.read_csv(csv_path)

print("=== SEC DATASET VERIFICATION ===")
# 1. Total rows
print(f"Total Rows: {len(df)}")

# 2. Total columns
print(f"Total Columns: {len(df.columns)}")
print(f"Columns list: {list(df.columns)}")

# 3. Company list
print("\nCompany List:")
for idx, name in enumerate(df['entity_name'], 1):
    print(f"  {idx}. {name} ({df.iloc[idx-1]['ticker']})")

# 4. Duplicate check
duplicate_tickers = df[df.duplicated(subset=['ticker'])]
print(f"\nDuplicates found in tickers: {len(duplicate_tickers)}")
if len(duplicate_tickers) > 0:
    print(duplicate_tickers[['entity_name', 'ticker']])

# 5. Completeness check
print("\nCompleteness Check (Non-Null Counts per Column):")
for col in df.columns:
    non_null_count = df[col].notna().sum()
    pct = (non_null_count / len(df)) * 100
    print(f"  {col}: {non_null_count}/{len(df)} ({pct:.1f}%)")

# Calculate completeness score for each row
row_completeness = []
for idx, row in df.iterrows():
    non_null_fields = sum(1 for val in row if pd.notna(val) and str(val).strip() != "" and str(val).lower() != 'nan')
    score = non_null_fields / len(df.columns)
    row_completeness.append((row['ticker'], non_null_fields, score))

row_completeness.sort(key=lambda x: x[2], reverse=True)
print("\nRow Completeness Ranking (Top 10):")
for t, count, score in row_completeness[:10]:
    print(f"  Ticker {t}: {count}/{len(df.columns)} fields populated ({score*100:.1f}%)")

# 6. Null-heavy row check
null_heavy = [item for item in row_completeness if item[2] < 0.5]
print(f"\nNull-heavy rows (<50% populated): {len(null_heavy)}")
for t, count, score in null_heavy:
    print(f"  Warning: Ticker {t} is null-heavy: {count}/{len(df.columns)} fields ({score*100:.1f}%)")
print("================================")
