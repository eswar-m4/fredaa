import os
import json
import pandas as pd
import numpy as np

# Resolve base dir
base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
csv_path = os.path.join(base_dir, "sample_keysight.csv")
xlsx_path = os.path.join(base_dir, "sample_keysight.xlsx")

if not os.path.exists(csv_path):
    raise FileNotFoundError(f"Original CSV not found at: {csv_path}")

# Load existing 10 records
df_orig = pd.read_csv(csv_path)
columns = list(df_orig.columns)
print(f"Loaded {len(df_orig)} records with {len(columns)} columns.")

# Prepare list of dicts for the new dataset
new_records = []

# Helper to check if a value is null
def is_null(val):
    return val is None or (isinstance(val, float) and np.isnan(val)) or str(val).lower() == 'nan'

# Define standard values for highly-complete records
complete_defaults = {
    "_store": "default",
    "_attribute_set": "Default",
    "_type": "simple",
    "_product_websites": "base",
    "allow_individual_quote_request": 1,
    "color": "Grey",
    "country_of_manufacture": "US",
    "custom_design": "Standard",
    "custom_design_from": "2026-01-01",
    "custom_design_to": "2027-12-31",
    "custom_layout_update": "None",
    "enable_googlecheckout": 1,
    "gift_message_available": 0,
    "gift_wrapping_available": 0,
    "gift_wrapping_price": 0.0,
    "has_options": 0,
    "isspecial": 0,
    "is_quotation": 1,
    "is_returnable": 1,
    "msrp_display_actual_price_type": 1,
    "msrp_enabled": 1,
    "news_from_date": "2026-01-01",
    "news_to_date": "2027-12-31",
    "options_container": "Block after info column",
    "page_layout": "No layout updates",
    "prod_type": "Hardware",
    "regarding_lead_time": "3-5 business days",
    "related_tgtr_position_behavior": "Default",
    "related_tgtr_position_limit": 5,
    "required_options": 0,
    "srt": 1,
    "status": "Enabled",
    "tax_class_id": 2,
    "unspsc": "41111902",
    "upsell_tgtr_position_behavior": "Default",
    "upsell_tgtr_position_limit": 5,
    "weight": 4.5,
    "qty": 15,
    "min_qty": 1,
    "use_config_min_qty": 1,
    "is_qty_decimal": 0,
    "backorders": 0,
    "use_config_backorders": 1,
    "min_sale_qty": 1,
    "use_config_min_sale_qty": 1,
    "max_sale_qty": 10,
    "use_config_max_sale_qty": 1,
    "is_in_stock": 1,
    "notify_stock_qty": 5,
    "use_config_notify_stock_qty": 1,
    "manage_stock": 1,
    "use_config_manage_stock": 1,
    "stock_status_changed_auto": 0,
    "use_config_qty_increments": 1,
    "qty_increments": 1,
    "use_config_enable_qty_inc": 1,
    "enable_qty_increments": 0,
    "is_decimal_divided": 0,
    "_links_related_sku": "10020A",
    "_links_related_position": 1,
    "_links_crosssell_sku": "10070C",
    "_links_crosssell_position": 2,
    "_links_upsell_sku": "10070D",
    "_links_upsell_position": 3,
    "_associated_sku": "10020A-ACC",
    "_associated_default_qty": 1,
    "_associated_position": 1,
    "_custom_option_store": "default",
    "_custom_option_configurator_header": "Options",
    "_custom_option_type": "field",
    "_custom_option_title": "Calibration Option",
    "_custom_option_is_required": 0,
    "_custom_option_price": 50.0,
    "_custom_option_sku": "CAL-OPT",
    "_custom_option_max_characters": 50,
    "_custom_option_sort_order": 1,
    "_custom_option_row_title": "Calibration Service",
    "_custom_option_row_price": 50.0,
    "_custom_option_row_sku": "CAL-SRV",
    "_custom_option_row_unspsc": "41111902",
    "_custom_option_row_sort": 1,
    "_option_title": "Warranty",
    "_option_row_title": "3-year Warranty",
    "_option_row_price": 100.0,
    "_option_row_sku": "WARN-3Y",
    "Selected_Configurations_row_title": "Standard Config",
    "Selected_Configurations_row_price": 0.0,
    "Selected_Configurations_row_sku": "STD-CONF",
    "Selected_Configurations_row_qty": 1,
    "Selected_Configurations_row_sort": 1,
    "Add_to_Cart_Flag": 1,
    "Configuration_Flag": 0,
    "Discontinued": False,
    "Navigation_category": "Products",
    "_root_category": "Keysight",
    "manufacturer": "Keysight"
}

# 1. Adapt and enrich the existing 10 records
for idx, row in df_orig.iterrows():
    rec = {col: (None if is_null(row[col]) else row[col]) for col in columns}
    sku = rec.get("sku")
    
    # Fill in complete defaults for fields that are null
    for k, v in complete_defaults.items():
        if rec.get(k) is None:
            rec[k] = v
            
    # Add unique numeric fields
    rec["cost"] = float(idx * 150 + 350)
    rec["price"] = float(idx * 150 + 500)
    rec["minimal_price"] = float(idx * 150 + 450)
    rec["msrp"] = float(idx * 150 + 550)
    rec["special_price"] = float(idx * 150 + 420)
    rec["special_from_date"] = "2026-01-01"
    rec["special_to_date"] = "2027-12-31"
    rec["specialends"] = "2027-12-31"
    
    # Standardize image URLs and models
    rec["image"] = f"https://www.keysight.com/us/en/assets/images/{sku}_main.png"
    rec["small_image"] = f"https://www.keysight.com/us/en/assets/images/{sku}_small.png"
    rec["thumbnail"] = f"https://www.keysight.com/us/en/assets/images/{sku}_thumb.png"
    rec["image_label"] = f"Main image for {sku}"
    rec["small_image_label"] = f"Small image for {sku}"
    rec["thumbnail_label"] = f"Thumbnail for {sku}"
    rec["_model_Num"] = sku
    rec["quotation_id"] = f"Q-{sku}"
    
    # Populate specific category logic if needed
    if rec.get("_category") is None or is_null(rec.get("_category")):
        rec["_category"] = "Product Information"
    if rec.get("category") is None or is_null(rec.get("category")):
        rec["category"] = "Probes"
        
    # Standardize metadata
    rec["meta_keyword"] = f"keysight, {sku}, test equipment"
    rec["meta_description"] = f"High fidelity parsed details for Keysight product model {sku}."
    rec["meta_title"] = f"Keysight {sku} - FREDA Sample Data"
    
    new_records.append(rec)

# 2. Add 5 more highly complete new records (total = 15 complete)
new_seeds = [
    {
        "sku": "34461A",
        "name": "34461A Digital Multimeter, 6.5 Digit, 300 V, 3 A",
        "description": "The Keysight 34461A Truevolt digital multimeter is the industry-standard replacement for the 34401A.",
        "category": "Digital Multimeters (DMM)",
        "product_family": "Truevolt Digital Multimeters",
        "product_series": "34460A/34461A/34465A/34470A Series",
        "region": "US / English",
        "url_path": "/us/en/product/34461A/digital-multimeter-6-5-digit.html",
        "url_key": "digital-multimeter-6-5-digit",
        "key_specs": '{"digits": "6.5", "accuracy": "0.0035%", "interfaces": "USB, LAN, GPIB"}',
        "features": "Truevolt technology; 6.5 digit resolution; Color display with graphing capability"
    },
    {
        "sku": "E36312A",
        "name": "E36312A Triple Output DC Power Supply, 80W, 6V/5A, 2x 25V/1A",
        "description": "Keysight E36312A is a clean, reliable, and full-featured triple output DC power supply.",
        "category": "Power Supplies",
        "product_family": "Power Supplies",
        "product_series": "E36300 Series",
        "region": "US / English",
        "url_path": "/us/en/product/E36312A/triple-output-power-supply.html",
        "url_key": "triple-output-power-supply",
        "key_specs": '{"outputs": "3", "power": "80W", "programming_accuracy": "0.05%"}',
        "features": "Low output noise; Programming/datalogging functions; Overvoltage/overcurrent protection"
    },
    {
        "sku": "MSOX4024A",
        "name": "MSOX4024A InfiniiVision Oscilloscope, 200 MHz, 4 Analog & 16 Digital Channels",
        "description": "Keysight MSOX4024A InfiniiVision 4000 X-Series oscilloscope features a 12.1-inch capacitive touch screen.",
        "category": "Oscilloscopes",
        "product_family": "InfiniiVision Oscilloscopes",
        "product_series": "General Series",
        "region": "US / English",
        "url_path": "/us/en/product/MSOX4024A/infiniivision-oscilloscope-200mhz.html",
        "url_key": "infiniivision-oscilloscope-200mhz",
        "key_specs": '{"bandwidth": "200 MHz", "channels": "4 analog, 16 digital", "sample_rate": "5 GSa/s"}',
        "features": "12.1-inch touch screen; Zone touch triggering; 1 million waveforms/sec update rate"
    },
    {
        "sku": "33500B",
        "name": "33500B Trueform Waveform Generator, 20 MHz, 1-Channel",
        "description": "Keysight 33500B Trueform Series waveform generator offers dual-channel capability and clean signals.",
        "category": "Waveform Generators",
        "product_family": "Trueform Waveform Generators",
        "product_series": "33500B/33600A Series",
        "region": "US / English",
        "url_path": "/us/en/product/33500B/trueform-waveform-generator.html",
        "url_key": "trueform-waveform-generator",
        "key_specs": '{"frequency": "20 MHz", "channels": "1", "waveform": "Sine, Square, Ramp, Pulse, Noise, Arb"}',
        "features": "Trueform technology for lowest jitter; High signal integrity; 16-bit resolution"
    },
    {
        "sku": "N5182B",
        "name": "N5182B MXG X-Series RF Vector Signal Generator, 9 kHz to 3 or 6 GHz",
        "description": "Keysight N5182B MXG RF vector signal generator is designed for high-throughput testing.",
        "category": "Signal Generators",
        "product_family": "X-Series Signal Generators",
        "product_series": "General Series",
        "region": "US / English",
        "url_path": "/us/en/product/N5182B/mxg-vector-signal-generator.html",
        "url_key": "mxg-vector-signal-generator",
        "key_specs": '{"frequency": "9 kHz to 6 GHz", "modulation": "AM, FM, PM, Pulse, IQ", "bandwidth": "160 MHz"}',
        "features": "High output power; Excellent phase noise; Fast switching speed"
    }
]

for idx, seed in enumerate(new_seeds):
    sku = seed["sku"]
    # Start with empty dict
    rec = {col: None for col in columns}
    # Populate essential fields
    rec["sku"] = sku
    rec["name"] = seed["name"]
    rec["description"] = seed["description"]
    rec["short_description"] = seed["description"][:250]
    rec["_category"] = "Product Information"
    rec["category"] = seed["category"]
    rec["product_family"] = seed["product_family"]
    rec["product_series"] = seed["product_series"]
    rec["region"] = seed["region"]
    rec["url_path"] = seed["url_path"]
    rec["url_key"] = seed["url_key"]
    rec["key_specs"] = seed["key_specs"]
    rec["features"] = seed["features"]
    
    # Fill in complete defaults
    for k, v in complete_defaults.items():
        if rec.get(k) is None:
            rec[k] = v
            
    # Add unique numeric fields
    rec["cost"] = float((idx + 10) * 150 + 350)
    rec["price"] = float((idx + 10) * 150 + 500)
    rec["minimal_price"] = float((idx + 10) * 150 + 450)
    rec["msrp"] = float((idx + 10) * 150 + 550)
    rec["special_price"] = float((idx + 10) * 150 + 420)
    rec["special_from_date"] = "2026-01-01"
    rec["special_to_date"] = "2027-12-31"
    rec["specialends"] = "2027-12-31"
    
    # Standardize image URLs and models
    rec["image"] = f"https://www.keysight.com/us/en/assets/images/{sku}_main.png"
    rec["small_image"] = f"https://www.keysight.com/us/en/assets/images/{sku}_small.png"
    rec["thumbnail"] = f"https://www.keysight.com/us/en/assets/images/{sku}_thumb.png"
    rec["image_label"] = f"Main image for {sku}"
    rec["small_image_label"] = f"Small image for {sku}"
    rec["thumbnail_label"] = f"Thumbnail for {sku}"
    rec["_model_Num"] = sku
    rec["quotation_id"] = f"Q-{sku}"
    rec["meta_keyword"] = f"keysight, {sku}, test equipment"
    rec["meta_description"] = f"High fidelity parsed details for Keysight product model {sku}."
    rec["meta_title"] = f"Keysight {sku} - FREDA Sample Data"
    
    new_records.append(rec)

# 3. Add 15 sparse records (total dataset = 30 records)
for idx in range(15):
    sku = f"SPARSE-{100 + idx}"
    rec = {col: None for col in columns}
    rec["sku"] = sku
    rec["name"] = f"Keysight Sparse Product {sku}"
    rec["_root_category"] = "Keysight"
    rec["manufacturer"] = "Keysight"
    rec["status"] = "Enabled"
    rec["is_in_stock"] = 1
    rec["qty"] = 5
    new_records.append(rec)

# Write to CSV
df_out = pd.DataFrame(new_records, columns=columns)
# Explicitly format null values correctly
df_out = df_out.where(pd.notnull(df_out), None)
df_out.to_csv(csv_path, index=False)
print(f"Successfully generated {len(df_out)} records in CSV at: {csv_path}")

# Write to XLSX
df_out.to_excel(xlsx_path, index=False)
print(f"Successfully generated {len(df_out)} records in XLSX at: {xlsx_path}")
