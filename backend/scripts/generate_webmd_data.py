import os
import sys
import time
import requests
import pandas as pd
import numpy as np

# Add workspace directory to python path to import scraper
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.services.scrapers.webmd_scraper import parse_physician_html, COLUMNS

base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
csv_path = os.path.join(base_dir, "sample_webmd.csv")
xlsx_path = os.path.join(base_dir, "sample_webmd.xlsx")

urls = [
    "https://doctor.webmd.com/doctor/dr-aaron-f-kulick-md-40da227b-da51-4b23-9b37-5fa345719ea4-overview",
    "https://doctor.webmd.com/doctor/dr-aananth-raman-md-b5e38f84-77cd-40b5-a00f-0403cbbc1bcd-overview",
    "https://doctor.webmd.com/doctor/dr-aaron-b-sheets-md-d95fb815-3988-46cb-9247-dfc56dc92054-overview",
    "https://doctor.webmd.com/doctor/dr-aaron-j-godshall-md-b9f2b147-d4fb-4946-95c5-563413516010-overview",
    "https://doctor.webmd.com/doctor/dr-aashish-dua-md-4fd2f563-790c-4b7c-9367-0bb7ff165ddd-overview",
    "https://doctor.webmd.com/doctor/dr-a-b-m-salah-uddin-md-bba33eda-e334-42ce-8c27-44bf2d4d04e6-overview",
    "https://doctor.webmd.com/doctor/dr-aaron-j-bellew-md-edba2263-6c96-4fb9-81ff-a3af3ad834ae-overview",
    "https://doctor.webmd.com/doctor/dr-aaron-l-knoll-md-fd3a4e4b-a17e-e111-a6a1-001f29e3eb44-overview",
    "https://doctor.webmd.com/doctor/dr-aaron-m-sudbury-md-fa3c85a4-fedb-40d6-a661-00517b195e29-overview",
    "https://doctor.webmd.com/doctor/dr-aban-fuentes-do-67767ca8-dd10-43ee-b072-161184e9183e-overview",
    "https://doctor.webmd.com/doctor/dr-abbas-s-ali-md-e791906c-f21e-47c2-b6d4-ad67e6642002-overview",
    "https://doctor.webmd.com/doctor/dr-abbie-d-jacobs-md-741e46be-ffba-481a-ab40-5277356afaca-overview",
    "https://doctor.webmd.com/doctor/dr-abdollah-n-iravani-md-647a92db-9dfd-4598-b967-746959eb8a75-overview",
    "https://doctor.webmd.com/doctor/dr-abdul-q-khan-md-4aded7b1-ca58-4e93-adbf-32d0ef06b288-overview",
    "https://doctor.webmd.com/doctor/dr-abdul-r-aziz-md-a3acaedc-5c2c-4279-a511-1271a5ee47d7-overview",
    "https://doctor.webmd.com/doctor/dr-abdul-r-shamsi-md-98ceb9bd-94b7-412f-936d-fae4d46cf6a6-overview",
    "https://doctor.webmd.com/doctor/dr-abdul-s-agha-md-151300b0-bb4c-42d8-a84b-5f78341aca8f-overview",
    "https://doctor.webmd.com/doctor/dr-abdulla-j-adib-md-3df3b3c8-ece7-4908-9dce-235d45a6a856-overview",
    "https://doctor.webmd.com/doctor/dr-abdur-rahim-md-3d73559a-496e-44c6-88ac-8fb9cc8d07b7-overview",
    "https://doctor.webmd.com/doctor/dr-abena-oseiwusu-md-abd78a19-2052-41a7-8df7-4b53accdcb26-overview",
    "https://doctor.webmd.com/doctor/dr-abey-sarai-md-0935c54c-a7c6-49d7-9d7c-b10a96aab838-overview",
    "https://doctor.webmd.com/doctor/dr-abhijit-b-power-md-c2f216c8-a370-4a84-9621-71b4f0c669de-overview",
    "https://doctor.webmd.com/doctor/dr-abhitabh-a-patil-md-b40472a8-120e-45e5-824c-fc97742f6da1-overview",
    "https://doctor.webmd.com/doctor/dr-abid-rasool-md-2074c07a-17e5-4e24-ac43-4a9edac803e1-overview",
    "https://doctor.webmd.com/doctor/dr-abraham-r-totah-md-861fddf7-e6e8-4c80-a511-dc34bd4a55b1-overview",
    "https://doctor.webmd.com/doctor/dr-abraham-w-friedman-md-182d586c-1a79-4069-8195-40fa330f375a-overview",
    "https://doctor.webmd.com/doctor/dr-adam-b-lowy-md-2eff27a3-78ed-4d7c-8f6b-e9ffc7011900-overview",
    "https://doctor.webmd.com/doctor/dr-adam-e-sohnen-md-6bb3001b-a256-4106-bced-10a447d7a88a-overview",
    "https://doctor.webmd.com/doctor/dr-adam-fenichel-md-4121a029-e70f-4335-be02-9693d11fa2b5-overview",
    "https://doctor.webmd.com/doctor/dr-adam-fleit-md-8fb24fb9-af0c-4b4f-bbac-ba30f5c4e087-overview",
    "https://doctor.webmd.com/doctor/dr-adam-j-gerber-md-1d7d3f49-1d72-48a5-b77e-9642aedfb8ee-overview",
    "https://doctor.webmd.com/doctor/dr-adam-m-brufsky-md-627fbf31-63df-4ea8-a9ea-7f1409e70b22-overview",
    "https://doctor.webmd.com/doctor/dr-adam-m-rosen-md-f6d458fe-4de6-4ff9-b2b9-976994610680-overview",
    "https://doctor.webmd.com/doctor/dr-adam-m-thomas-md-d9c84284-ed58-458e-b644-0166f81c86d3-overview",
    "https://doctor.webmd.com/doctor/dr-adam-p-cugalj-do-13a173f7-685a-4573-9069-d630fe9f27b5-overview"
]

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

records = []
print(f"Scraping {len(urls)} WebMD profiles...")

for idx, url in enumerate(urls):
    print(f"[{idx+1}/{len(urls)}] Fetching: {url}")
    try:
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            rec = parse_physician_html(r.text, url)
            if rec.get("Primary_Contact_Name"):
                records.append(rec)
                print(f"  Successfully scraped: {rec['Primary_Contact_Name']}")
            else:
                print("  Failed to parse name from html")
        else:
            print(f"  Status code: {r.status_code}")
    except Exception as e:
        print(f"  Error: {e}")
    time.sleep(0.5)

print(f"Total parsed records: {len(records)}")

# Fill up to 30 records
df_out = pd.DataFrame(records, columns=COLUMNS)
df_out = df_out.where(pd.notnull(df_out), None)

# Save to CSV and Excel
df_out.to_csv(csv_path, index=False)
df_out.to_excel(xlsx_path, index=False)
print("Saved WebMD datasets to disk.")
