import requests
import json
import datetime
import sys
import re
import os
import shutil
from collections import defaultdict
import pandas as pd
import time


def regex_match(regex,content):
    match=re.search(regex,content,flags=re.I)
    if match:
        return match.group(1)
    return ''


def day_light_saving():
    days={'Sunday':7,'Monday':6,'Tuesday':5,'Wednesday':4,'Thursday':3,'Friday':2,'Saturday':1}
    date = datetime.datetime.utcnow()
    day_name = date.strftime('%A')
    month = int(date.strftime('%m'))
    day = int(date.strftime('%d'))
    diff=31-day
    if((month>3 and month<10) or ((diff<days[day_name] and month==3) or (diff>days[day_name]-1 and month==10))):
        return date+datetime.timedelta(hours=1)
    return date


def make_directory(folder):
    if not os.path.exists(folder):
        os.makedirs(folder)


def safe_json_response(response, fallback, label):
    try:
        return response.json()
    except Exception as exc:
        print(f"[WARN] Skipping {label}: {exc}")
        return fallback


def get_nom_renom_data(start_day,end_day):
    today_date = day_light_saving().strftime('%Y-%m-%d')
    epochtime = int(datetime.datetime.timestamp(datetime.datetime.now())*1000)
    captured_date=day_light_saving().strftime('%Y-%m-%dT%H:%M:%SZ')
    ######################################################################
    
    # obj = sess.get('https://data.nationalgas.com/api/gas-data-reports-folders',headers={'Accept':'application/json, text/plain, */*','Connection':'keep-alive','Host':'data.nationalgas.com','Referer': 'https://data.nationalgas.com/reports/find-gas-reports','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36','traceparent': '00-132b2a4747084ce890be45a04a7f4bfc-4d703784879944e7-01'})

    # with open('production_home_content.html','wb') as fh:
        # fh.write(obj.content)
    # print(obj.status_code)
    nom_data_values={}
    renom_data_values={}
    point_mapping=config_data['nomination']['point_mapping']
    for day in range(start_day,end_day+1):
        start_date_ldz = datetime.datetime.strptime((day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 00:00:00'),'%Y-%m-%d %H:%M:%S')
        start_date_filename = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d-%m-%Y')
        period_from = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 05:00:00.000')
        period_to = (datetime.datetime.strptime(period_from,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d 05:00:00.000')
        payload ={"reportName":"Nomination Report","gasDay":str(start_date_ldz)}
        
        obj = sess.post('https://data.nationalgas.com/api/reports',json=payload,headers={'Accept': 'application/json, text/plain, */*','Content-Type': 'application/json','Connection': 'keep-alive','traceparent': '00-1d78b05a6fc54defbf6eba0c8e665429-060b25ab9d424ffe-01','Host': 'data.nationalgas.com','Referer': 'https://data.nationalgas.com/reports/find-gas-reports/view','Request-Id': '|1d78b05a6fc54defbf6eba0c8e665429.-','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'})
        print(obj.status_code)
        with open(f'{cache_path_nom}NationalGrid_detail_content_Nomination_{file_date}_{start_date_filename}.json','wb') as fh:
            fh.write(obj.content)
        nomination_data=safe_json_response(obj, {}, 'nomination data')
        try:
            for nom_data_block in nomination_data['tableData'][0]['data']:
                if nom_data_block["Nomination, D-1 (as at 17:00 hours)"]==None:
                    nom_data_values[f'{nom_data_block["SITE NAME"]} {nom_data_block["SITE TYPE"]}']=0
                else:
                    nom_data_values[f'{nom_data_block["SITE NAME"]} {nom_data_block["SITE TYPE"]}']=nom_data_block["Nomination, D-1 (as at 17:00 hours)"]
                renom_data_values[f'{nom_data_block["SITE NAME"]} {nom_data_block["SITE TYPE"]}']=''
                for key in ['Final EOD Nomination, D+1 (as at 5:00 hours)','Re-nominations, Prevailing  EOD for D (as at 23:00 hours)','Re-nominations, Prevailing  EOD for D (as at 17:00 hours)','Re-nominations, Prevailing  EOD for D (as at 11:00 hours)','Re-nominations, Prevailing  EOD for D (as at 6:00 hours)']:
                # for key in ['Final EOD Nomination, D+1 (as at 4:00 hours)','Re-nominations, Prevailing  EOD for D (as at 23:00 hours)','Re-nominations, Prevailing  EOD for D (as at 17:00 hours)','Re-nominations, Prevailing  EOD for D (as at 11:00 hours)','Re-nominations, Prevailing  EOD for D (as at 6:00 hours)']: ##daylight saving 31-10-2023
                    if key == 'Final EOD Nomination, D+1 (as at 5:00 hours)':
                        value = nom_data_block.get(key,nom_data_block.get('Final EOD Nomination, D+1 (as at 4:00 hours)'))
                    else:
                        value = nom_data_block.get(key)
                    if value!=None:
                        renom_data_values[f'{nom_data_block["SITE NAME"]} {nom_data_block["SITE TYPE"]}']=value
                        break
        except:
            pass
        for point_name in point_mapping:
            state = 'Provisional'
            entry_energy=''
            exit_energy=''
            if point_mapping[point_name]['entry']!='':
                entry_energy = nom_data_values.get(point_mapping[point_name]['entry'],0)
             
            if point_mapping[point_name]['exit']!='':
                exit_energy = nom_data_values.get(point_mapping[point_name]['exit'],'0')
            if entry_energy=='' and exit_energy=='':
                state = 'Missing'
            if point_name=='LDZ Direct-NDM':
                entry_energy_1 = nom_data_values.get(point_mapping[point_name]['entry'],'0')
                entry_energy_2 = nom_data_values.get('Non Daily Meters Non Daily Meters','0')
                entry_energy_ldz =entry_energy_1 + entry_energy_2
                exit_energy = nom_data_values.get(point_mapping[point_name]['exit'],'0')
                nomwh.write(f'National Gas|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|nomination|{captured_date}||{state}|{entry_energy_ldz}|kwh|||||{config_data["nomination"]["gcv"][point_name]}|MJ/Scm|{exit_energy}|kwh|||||{config_data["nomination"]["gcv"][point_name]}|MJ/Scm|||||||||New\n')
            elif point_name=='Grain':
                entry_energy_1 = nom_data_values.get(point_mapping[point_name]['entry'],'0')
                print('period_from: ',period_from,' entry_energy_1: ',entry_energy_1)
                # input()
                entry_energy_2 = nom_data_values.get('Grain NTS 2 LNG LNG Importation','0')
                entry_energy_ldz =int(entry_energy_1) + int(entry_energy_2)
                exit_energy = nom_data_values.get(point_mapping[point_name]['exit'],'0')
                entry_energy_ldz =str(entry_energy_ldz)
                nomwh.write(f'National Gas|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|nomination|{captured_date}||{state}|{entry_energy_ldz}|kwh|||||{config_data["nomination"]["gcv"][point_name]}|MJ/Scm|{exit_energy}|kwh|||||{config_data["nomination"]["gcv"][point_name]}|MJ/Scm|||||||||New\n')        
            else:
                nomwh.write(f'National Gas|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|nomination|{captured_date}||{state}|{entry_energy}|kwh|||||{config_data["nomination"]["gcv"][point_name]}|MJ/Scm|{exit_energy}|kwh|||||{config_data["nomination"]["gcv"][point_name]}|MJ/Scm|||||||||New\n')
                if point_name == 'Bacton BBL Interconnector':
                    nomwh.write(f'Gasunie Transport Services|Julianadorp (BBL)|{period_from}|{period_to}|gas-day|{gas_hour}|nomination|{captured_date}||{state}|{exit_energy}|kwh|||||{config_data["nomination"]["gcv"][point_name]}|MJ/Scm|{entry_energy}|kwh|||||{config_data["nomination"]["gcv"][point_name]}|MJ/Scm|||||||||New\n')
            
            state = 'Provisional'
            # print(point_name)
            entry_energy=''
            exit_energy=''
            if point_mapping[point_name]['entry']!='':
                entry_energy = renom_data_values.get(point_mapping[point_name]['entry'],'0')
            if point_mapping[point_name]['exit']!='':
                exit_energy = renom_data_values.get(point_mapping[point_name]['exit'],'0')
            if entry_energy=='' and exit_energy=='':
                state = 'Missing'
            if point_name=='LDZ Direct-NDM':
                entry_energy_1 = renom_data_values.get(point_mapping[point_name]['entry'],'0')
                entry_energy_2 = renom_data_values.get('Non Daily Meters Non Daily Meters','0')
                entry_energy_ldz =entry_energy_1 + entry_energy_2
                exit_energy = renom_data_values.get(point_mapping[point_name]['exit'],'0')
                renomwh.write(f'National Gas|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|re-nomination|{captured_date}||{state}|{entry_energy_ldz}|kwh|||||{config_data["renomination"]["gcv"][point_name]}|MJ/Scm|{exit_energy}|kwh|||||{config_data["renomination"]["gcv"][point_name]}|MJ/Scm|||||||||New\n')
            elif point_name=='Grain':
                entry_energy_1 = renom_data_values.get(point_mapping[point_name]['entry'],'0')
                entry_energy_2 = renom_data_values.get('Grain NTS 2 LNG LNG Importation','0')
                entry_energy_ldz =entry_energy_1 + entry_energy_2
                exit_energy = renom_data_values.get(point_mapping[point_name]['exit'],'0')
                renomwh.write(f'National Gas|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|re-nomination|{captured_date}||{state}|{entry_energy_ldz}|kwh|||||{config_data["renomination"]["gcv"][point_name]}|MJ/Scm|{exit_energy}|kwh|||||{config_data["renomination"]["gcv"][point_name]}|MJ/Scm|||||||||New\n')
            else:
                renomwh.write(f'National Gas|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|re-nomination|{captured_date}||{state}|{entry_energy}|kwh|||||{config_data["renomination"]["gcv"][point_name]}|MJ/Scm|{exit_energy}|kwh|||||{config_data["renomination"]["gcv"][point_name]}|MJ/Scm|||||||||New\n')
                if point_name == 'Bacton BBL Interconnector':
                    renomwh.write(f'Gasunie Transport Services|Julianadorp (BBL)|{period_from}|{period_to}|gas-day|{gas_hour}|re-nomination|{captured_date}||{state}|{exit_energy}|kwh|||||{config_data["renomination"]["gcv"][point_name]}|MJ/Scm|{entry_energy}|kwh|||||{config_data["renomination"]["gcv"][point_name]}|MJ/Scm|||||||||New\n')

def get_demand_data(start_day,end_day):
    start_date = (day_light_saving()+datetime.timedelta(days=start_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
    end_date = (day_light_saving()+datetime.timedelta(days=end_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')

    start_date = (day_light_saving()+datetime.timedelta(days=start_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
    
    print('start_date: ',start_date,'end_date: ',end_date)
    today_date = day_light_saving().strftime('%Y-%m-%d')
    epochtime = int(datetime.datetime.timestamp(datetime.datetime.now())*1000)
    #######################################################################
    
    obj = sess.get('https://data.nationalgas.com/api/find-gas-data-folders',headers={'Accept':'application/json, text/plain, */*','Connection':'keep-alive','Host':'data.nationalgas.com','Referer': 'https://data.nationalgas.com/find-gas-data','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36','traceparent': '00-05b2777fc3f44081bf4bbf35dd288f7d-08d01d397ff64f7e-01'})

    with open('home_content.html','wb') as fh:
        fh.write(obj.content)
        print(obj.status_code)

    ##################################Internal and Total########################################
    # payload ={"latestFlag":"Y","applicableFor":"Y","dateTo":end_date,"dateFrom":start_date,"dateType":"GASDAY","ids":"PUBOBJ1026,PUBOBJ1023,PUBOBJ1025,PUBOBJ1660,PUBOB4507,PUBOB4508,PUBOB4510,PUBOB4509,PUBOB4511,PUBOB4512,PUBOB4513,PUBOB4514,PUBOB4515,PUBOB4516,PUBOB4517,PUBOB4518,PUBOB4519,PUBOB4521,PUBOB4520,PUBOB4522,PUBOBJ1661,PUBOBJ1662,PUBOBJ1026,PUBOBJ1018,PUBOBJ1023,PUBOBJ1015,PUBOBJ1025,PUBOBJ1017,PUBOB637,PUBOBJ1030"}    
    payload ={"latestFlag":"Y","applicableFor":"Y","dateTo":end_date,"dateFrom":start_date,"dateType":"GASDAY","ids":"PUBOBJ1026,PUBOBJ1023,PUBOBJ1025,PUBOBJ1660,PUBOB4507,PUBOB4508,PUBOB4510,PUBOB4509,PUBOB4511,PUBOB4512,PUBOB4513,PUBOB4514,PUBOB4515,PUBOB4516,PUBOB4517,PUBOB4518,PUBOB4519,PUBOB4521,PUBOB4520,PUBOB4522,PUBOBJ1661,PUBOBJ1662,PUBOBJ1026,PUBOBJ1018,PUBOBJ1023,PUBOBJ1015,PUBOBJ1025,PUBOBJ1017,PUBOB637,PUBOBJ1030,PUBOBJ1026,PUBOBJ1018,PUBOBJ1023,PUBOBJ1015,PUBOBJ1025,PUBOBJ1017,PUBOB637,PUBOBJ1030"}    
        
    obj = sess.post('https://data.nationalgas.com/api/find-gas-data',json=payload,headers={'Accept': 'application/json, text/plain, */*','Content-Type': 'application/json','Connection': 'keep-alive','traceparent': '00-f8ee51f88f4543de865dd7263e214a5f-23ee9cbced944757-01','Host': 'data.nationalgas.com','Referer': 'https://data.nationalgas.com/find-gas-data/view','Request-Id': '|f8ee51f88f4543de865dd7263e214a5f.23ee9cbced944757','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36','Sec-Fetch-Dest': 'empty','Sec-Fetch-Mode': 'cors','Sec-Fetch-Site': 'same-origin','sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"','sec-ch-ua-mobile': '?0','sec-ch-ua-platform': '"Windows"'})

    # with open(f'{cache_path}NationalGrid_detail_content{file_date}_{start_date}.json','wb') as fh:
    with open(f'{cache_path_demand}NationalGrid_Demand_detail_content_Internal_Total_{file_date}_{start_date}_{end_date}.json','wb') as fh:
        fh.write(obj.content)
    print(obj.status_code)    

    point_list=safe_json_response(obj, {}, 'demand point list')
    demand_dict={}
    captured_date=day_light_saving().strftime('%Y-%m-%dT%H:%M:%SZ')
    for point_block in point_list['data']:
        Date = point_block['applicableFor']
        Value = point_block['value']
        DataType = point_block['itemName']
        # dict_key = DataType.'_'.Date
        print('DataType: ',DataType,'Value: ',Value,'Date: ',Date)
        if DataType not in demand_dict:
            demand_dict[DataType]={}
            
        demand_dict[DataType][Date]=Value
    ########################Total demand D+4 starts######################    
    payload ={"request":"demandForecastMarginNotices"}    
        
    obj = sess.post('https://data.nationalgas.com/api/gas-system-status-data',json=payload,headers={'Accept': 'application/json, text/plain, */*','Content-Type': 'application/json','Connection': 'keep-alive','traceparent': '00-d0a10871b1be435ebd836ac9ab6a378a-fa920a537adc4225-01','Host': 'data.nationalgas.com','Referer': 'https://data.nationalgas.com/gas-system-status','Request-Id': '|d0a10871b1be435ebd836ac9ab6a378a.fa920a537adc4225','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36','Sec-Fetch-Dest': 'empty','Sec-Fetch-Mode': 'cors','Sec-Fetch-Site': 'same-origin','sec-ch-ua': '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"','sec-ch-ua-mobile': '?0','sec-ch-ua-platform': '"Windows"'})

    # with open(f'{cache_path}NationalGrid_detail_content{file_date}_{start_date}.json','wb') as fh:
    with open(f'{cache_path_demand}NationalGrid_detail_content_Total_Forecas_D4_{file_date}_{start_date}_{end_date}.json','wb') as fh:
        fh.write(obj.content)
        print(obj.status_code)    
        
    point_list=safe_json_response(obj, {}, 'forecast demand point list')
    captured_date=day_light_saving().strftime('%Y-%m-%dT%H:%M:%SZ')
    for point_block in point_list['data']:
        Day = point_block
        # input(Day)
        try:
            # Value = point_list['data'][Day]['demandForecast']
            Value = point_list.get('data',[{}])[Day].get('demandForecast','')
            Day=re.sub('day','',Day,flags=re.I)
            Value=re.sub('{}','',Value,flags=re.I)
            print('day: ',Day,'Value: ',Value)
            # input()
        except:
            pass
        start_date_write = (day_light_saving()+datetime.timedelta(days=int(Day))+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d/%m/%Y')    
        print('start_date_write :', start_date_write)
        # input()
        # DataType = point_block['itemName']
        # # dict_key = DataType.'_'.Date
        # print('DataType: ',DataType,'Value: ',Value,'Date: ',Date)
        # if DataType not in demand_dict:
            # demand_dict[DataType]={}
            
        demand_dict['Demand Actual, NTS, D+1'][start_date_write]=Value
        
        
    ########################Total demand D+4 ends######################    
    ###################################LDZ#####################################
    LDZ_demand={}    
    for day in range(start_day,end_day):
    
        start_date_ldz = datetime.datetime.strptime((day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 00:00:00'),'%Y-%m-%d %H:%M:%S')
        start_date = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d/%m/%Y')
        start_date_filename = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d-%m-%Y')
        
        payload ={"reportName":"Forecast Demands (SISR03)","gasDay":str(start_date_ldz)}
            
        obj = sess.post('https://data.nationalgas.com/api/reports',json=payload,headers={'Accept': 'application/json, text/plain, */*','Content-Type': 'application/json','Connection': 'keep-alive','traceparent': '00-f8ee51f88f4543de865dd7263e214a5f-23ee9cbced944757-01','Host': 'data.nationalgas.com','Referer': 'https://data.nationalgas.com/reports/find-gas-reports/view','Request-Id': '|5b0073e789b74ca090a2a37c63c4baf3.051dd6af5ad44cb3','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'})
        
        # with open(f'{cache_path}NationalGrid_detail_content_LDZ{file_date}_{start_date_filename}.json','wb') as fh:
        with open(f'{cache_path_demand}NationalGrid_detail_content_LDZ{file_date}_{start_date_filename}.json','wb') as fh:
            fh.write(obj.content)
            print(obj.status_code)    
        totalblock=safe_json_response(obj, {}, 'demand total block')
        try:
            Value_LDZ=totalblock['tableData'][0]['data'][-1]['Demand (mscm)']
            name = totalblock['tableData'][0]['data'][-1]['LDZ']
            # if DataType not in demand_dict:
            LDZ_demand[start_date]=Value_LDZ
        except:    
            LDZ_demand[start_date]=''
        
    ##################################writing part#####################################
    print('writing part started')
    for day in range(start_day,end_day):
        period_from = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 05:00:00.000')
        period_to = (datetime.datetime.strptime(period_from,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S.000')
        start_date_write = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d/%m/%Y')
        ##################Internal demand#########################

        Industrial_value_Energy = demand_dict['NTS Energy Offtaken, Industrial Offtake Total'].get(start_date_write,'')
        Industrial_value_Volume = demand_dict['NTS Volume Offtaken, Industrial Offtake Total'].get(start_date_write,'')
        
        Power_value_Energy = demand_dict['NTS Energy Offtaken, Powerstations Total'].get(start_date_write,'')
        Power_value_Volume = demand_dict['NTS Volume Offtaken, Powerstations Total'].get(start_date_write,'')
            
        LDZ_value_Energy = demand_dict['NTS Energy Offtaken, LDZ Offtake Total'].get(start_date_write,'')
        LDZ_value_Volume = demand_dict['NTS Volume Offtaken, LDZ Offtake Total'].get(start_date_write,'')
        Total_Value_Energy=0
        Total_Value_volume=0
        if Industrial_value_Energy!='':
            Total_Value_Energy = float(Industrial_value_Energy)
            Total_Value_volume = float(Industrial_value_Volume)
        if Power_value_Energy!='':
            Total_Value_Energy+=float(Power_value_Energy)
            Total_Value_volume+=float(Power_value_Volume)
        if LDZ_value_Energy!='':
            Total_Value_Energy+=float(LDZ_value_Energy)
            Total_Value_volume+=float(LDZ_value_Volume)
        if Industrial_value_Energy=='' and Power_value_Energy=='' and LDZ_value_Energy=='':
            Total_Value_Energy=''
            Total_Value_volume=''
        print('Industrial_value_Energy: ',Industrial_value_Energy,'Industrial_value_Volume: ',Industrial_value_Volume)
        print('Power_value_Energy: ',Power_value_Energy,'Power_value_Volume: ',Power_value_Volume)
        print('LDZ_value_Energy: ',LDZ_value_Energy,'LDZ_value_Volume: ',LDZ_value_Volume)
        
        ##########################################################
        if Total_Value_Energy == '':
            demwh.write(f'National Gas|Internal demand|{period_from}|{period_to}|gas-day|{gas_hour}|{captured_date}||Missing||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||New\n')    
        else:
            if period_from == '2024-06-28 05:00:00.000':
                pass
            else:
                demwh.write(f'National Gas|Internal demand|{period_from}|{period_to}|gas-day|{gas_hour}|{captured_date}||Provisional||{Total_Value_Energy}|KWH||{Total_Value_volume}|MCM||||||||||||{Industrial_value_Energy}|KWH||{Industrial_value_Volume}|MCM||||{Power_value_Energy}|KWH||{Power_value_Volume}|MCM||||||||||||{LDZ_value_Energy}|KWH||{LDZ_value_Volume}|MCM||||||||||||||||||||||||||||New\n')
        ##########################################################
        ##################Total demand#########################
        
        Total_Demand_volume = demand_dict['Demand Actual, NTS, D+1'].get(start_date_write,'')
        Total_gcv='10.93317851010101';
        Total_gcv_unit='kWh/Sm3';
        if Total_Demand_volume == '':
            demwh.write(f'National Gas|Total Demand|{period_from}|{period_to}|gas-day|{gas_hour}|{captured_date}||Missing|H|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||New\n')    
        else:
            demwh.write(f'National Gas|Total Demand|{period_from}|{period_to}|gas-day|{gas_hour}|{captured_date}||Provisional|H||||{Total_Demand_volume}|MCM||{Total_gcv}|{Total_gcv_unit}||||||||||KWH|||MCM|||||KWH|||MCM|||||||||||||KWH|||MCM||||||||||||||||||||||||||||New\n')
        ########################################################
        ######################LDZ##############################
        LDZ_demand_value = LDZ_demand[start_date_write]
        LDZ_gcv='10.93317851001';
        LDZ_gcv_unit='kWh/Sm3';
        if LDZ_demand_value == '':
            demwh.write(f'National Gas|Forecast LDZ|{period_from}|{period_to}|gas-day|{gas_hour}|{captured_date}||Missing|H|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||New\n')    
        else:
            demwh.write(f'National Gas|Forecast LDZ|{period_from}|{period_to}|gas-day|{gas_hour}|{captured_date}||Provisional|H||||{LDZ_demand_value}|MCM||{LDZ_gcv}|{LDZ_gcv_unit}||||||||||KWH|||MCM|||||KWH|||MCM|||||||||||||KWH||{LDZ_demand_value}|MCM||{LDZ_gcv}|{LDZ_gcv_unit}|||||||||||||||||||||||||New\n')

    ######################### Demand Intra Day - Starts###############
    obj = sess.get('https://data.nationalgas.com/api/customisable-downloads-locations',headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'})
    with open(f'{cache_path_gasflow}Demand_Intraday_IP_List_{file_date}.json','wb') as fh:
    # with open(f'Demand_Intraday_IP_List_{file_date}.json','wb') as fh:
        fh.write(obj.content)
    ip_id_list=safe_json_response(obj, {}, 'demand intraday IP list')
    all_points_hourly_value={}
    point_mapping={"Holford":{"entry":"HOLFORD","exit":""},"Milford Haven - Dragon":{"entry":"MILFORD HAVEN - DRAGON","exit":""},"Moffat Interconnector":{"entry":"","exit":"Moffat Export"},"Rough":{"entry":"EASINGTON ROUGH ST","exit":""},"Hole House Farm":{"entry":"HOLE HOUSE FARM","exit":""},"Easington-Langeled":{"entry":"EASINGTON LANGELED","exit":""},"Hornsea":{"entry":"HORNSEA","exit":""},"Interconnector Export Demand flow":{"entry":"","exit":"Interconnector Export Demand Flow"},"Storage Demand flow":{"entry":"","exit":"Storage Demand Flow"},}
    while start_day<end_day-4:
        s=start_day
        e=start_day+2
        if e>end_day:
            e=end_day
        start_date = (day_light_saving()+datetime.timedelta(days=s-1)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
        end_date = (day_light_saving()+datetime.timedelta(days=e)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
        print(f'start_date  ::  {start_date}, end_date  ::  {end_date}')
        while True:
            try:
                obj = sess.post('https://data.nationalgas.com/api/customisable-downloads-download?',json={"ids":"585,583,584,588","fromDate":start_date,"toDate":end_date,"isLatest":True,"type":"CSV"},headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36','Referer':'https://data.nationalgas.com/reports/customisable-downloads'})
                file_name = f'Demand_Intraday_detail_content_{start_date}_{end_date}_{file_date}.csv'
                with open(file_name,'wb') as fh:
                    fh.write(obj.content)
                # print(obj.content)
                # input()
                output_data = pd.read_csv(file_name,index_col=False)
                output_data = output_data.sort_values(by=['System Entry Name','Timestamp'])
                shutil.move(file_name,cache_path_gasflow)
                break
            except:
                print('Demand intraday content fetch retry')
                time.sleep(30)
                os.remove(file_name)
                
        start_day+=2
        total_hours = 1
        total_values = 0
        prev_hour = 0
        flag=0
        prev_ip_name=''
        
        for row_num, row_data in enumerate(output_data.values):
            date_hour = row_data[3]
            ip_name = row_data[0]
            value = row_data[2]
            org_date_hour = date_hour
            if prev_ip_name!=ip_name:
                flag=0
            prev_ip_name=ip_name
            current_hour = datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S').hour
            current_minute = datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S').minute
            temp_date_hour = datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S').strftime('%Y-%m-%d %H:15:00.000')
            if current_hour!=5 and flag==0:
                continue
            flag=1
            if current_hour==4 and current_minute>15:
                continue
            if ((current_hour==5 and current_minute>15) or (current_hour>5) or (current_hour<4) or (current_hour==4 and current_minute<=15)):
                current_hour = (datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S')+datetime.timedelta(minutes=45)).hour
                temp_date_hour = (datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S')+datetime.timedelta(minutes=45)).strftime('%Y-%m-%d %H:15:00.000')
            date_hour=temp_date_hour
            # input()
            if current_hour==5 and prev_hour!=current_hour:
                total_values = 0
                total_hours = 0
            prev_hour=current_hour
            if date_hour not in all_points_hourly_value:
                all_points_hourly_value[date_hour]={}
            if ip_name not in all_points_hourly_value:
                all_points_hourly_value[date_hour][ip_name]={}
            total_values+=float(value)
            total_hours+=1
            all_points_hourly_value[date_hour][ip_name]['value']=total_values
            all_points_hourly_value[date_hour][ip_name]['average']=total_hours
    for period_to in all_points_hourly_value.keys():
        period_from = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')-datetime.timedelta(minutes=315)).strftime('%Y-%m-%d 05:00:00.000')
        gh = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')-datetime.timedelta(hours=5)).hour+1
        #############ak################
        period_from_new = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')).strftime('%Y-%m-%d %H:00:00.000')
        period_to_new = (datetime.datetime.strptime(period_from_new,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(hours=1)).strftime('%Y-%m-%d %H:00:00.000')
        #############################
        state = 'Provisional'
        Industrial_value_Volume = all_points_hourly_value[period_to].get('Industrial Demand Flow',{}).get('value','')
        Power_value_Volume = all_points_hourly_value[period_to].get('Power Station Demand Flow',{}).get('value','')
        LDZ_value_Volume = all_points_hourly_value[period_to].get('LDZ Offtake Flow',{}).get('value','')
        
        if Industrial_value_Volume!='':
            Industrial_value_Volume = Industrial_value_Volume/all_points_hourly_value[period_to].get('Industrial Demand Flow',{}).get('average',1)
        if Power_value_Volume!='':
            Power_value_Volume = Power_value_Volume/all_points_hourly_value[period_to].get('Power Station Demand Flow',{}).get('average',1)
        if LDZ_value_Volume!='':
            LDZ_value_Volume = LDZ_value_Volume/all_points_hourly_value[period_to].get('LDZ Offtake Flow',{}).get('average',1)    
        ##########################################################
        Total_Value_volume = Industrial_value_Volume + Power_value_Volume + LDZ_value_Volume
        GCV_unit_internal=GCV_values_internal=""
        GCV_unit_internal='kWh/Nm3'
        GCV_values_internal='11.35'
        if Total_Value_volume == '':
            demwh.write(f'National Gas|Internal Demand|{period_from}|{period_to}|intra-day|{gh}|{captured_date}||Missing||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||New\n')    
        else:
            demwh.write(f'National Gas|Internal Demand|{period_from}|{period_to}|intra-day|{gh}|{captured_date}||Provisional|||||{Total_Value_volume}|mcm||{GCV_values_internal}|{GCV_unit_internal}||||||||||||{Industrial_value_Volume}|mcm||{GCV_values_internal}|{GCV_unit_internal}||||{Power_value_Volume}|mcm||{GCV_values_internal}|{GCV_unit_internal}||||||||||||{LDZ_value_Volume}|mcm||{GCV_values_internal}|{GCV_unit_internal}|||||||||||||||||||||||||New\n')
        ##########################################################
        Total_Demand_volume = all_points_hourly_value[period_to].get('NTS Demand Flow',{}).get('value','')
        if Total_Demand_volume!='':
            Total_Demand_volume = Total_Demand_volume/all_points_hourly_value[period_to].get('NTS Demand Flow',{}).get('average',1)
        ##########################################################
        Total_gcv='10.93317851010101';
        Total_gcv_unit='kWh/Sm3';
        if Total_Demand_volume == '':
            demwh.write(f'National Gas|Total Demand|{period_from}|{period_to}|intra-day|{gh}|{captured_date}||Missing|H|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||New\n')    
        else:
            demwh.write(f'National Gas|Total Demand|{period_from}|{period_to}|intra-day|{gh}|{captured_date}||Provisional|H||||{Total_Demand_volume}|mcm||{Total_gcv}|{Total_gcv_unit}|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||New\n')
#########################    Demand Intra Day - End###############
    
def get_sso_data(start_day,end_day):
    start_date = (day_light_saving()+datetime.timedelta(days=start_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
    end_date = (day_light_saving()+datetime.timedelta(days=end_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')

    start_date = (day_light_saving()+datetime.timedelta(days=start_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
    
    print('start_date: ',start_date,'end_date: ',end_date)
    today_date = day_light_saving().strftime('%Y-%m-%d')
    epochtime = int(datetime.datetime.timestamp(datetime.datetime.now())*1000)
    #######################################################################
    
    obj = sess.get('https://data.nationalgas.com/api/find-gas-data-folders',headers={'Accept':'application/json, text/plain, */*','Connection':'keep-alive','Host':'data.nationalgas.com','Referer': 'https://data.nationalgas.com/find-gas-data','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36','traceparent': '00-05b2777fc3f44081bf4bbf35dd288f7d-08d01d397ff64f7e-01'})

    with open('SSO_home_content.html','wb') as fh:
        fh.write(obj.content)
    print(obj.status_code)

    ##############################SSO################################
    # navigation steps
    # https://data.nationalgas.com/find-gas-data => Click Storage -> Actuals -> Select all
    payload ={"latestFlag":"Y","applicableFor":"Y","dateTo":end_date,"dateFrom":start_date,"dateType":"GASDAY","ids":"PUBOBJ331,PUBOBJ332,PUBOBJ330"}    
    while True:
        try:
            obj = sess.post('https://data.nationalgas.com/api/find-gas-data',json=payload,headers={'Accept': 'application/json, text/plain, */*','Content-Type': 'application/json','Connection': 'keep-alive','traceparent': '00-c5098a2ca9334711b4b349a72b40cca6-6eb9d4dc6aab49f5-01','Host': 'data.nationalgas.com','Referer': 'https://data.nationalgas.com/find-gas-data/view','Request-Id': '|c5098a2ca9334711b4b349a72b40cca6.6eb9d4dc6aab49f5','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36','Sec-Fetch-Dest': 'empty','Sec-Fetch-Mode': 'cors','Sec-Fetch-Site': 'same-origin','sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"','sec-ch-ua-mobile': '?0','sec-ch-ua-platform': '"Windows"'})

            # with open(f'{cache_path}NationalGrid_detail_content{file_date}_{start_date}.json','wb') as fh:
            with open(f'{cache_path_sso}NationalGrid_detail_content_SSO_{file_date}_{start_date}_{end_date}.json','wb') as fh:
                fh.write(obj.content)
            print(obj.status_code)    

            ######################
            point_list_SSO=safe_json_response(obj, {}, 'SSO point list')
            break
        except:
            os.remove(f'{cache_path_sso}NationalGrid_detail_content_SSO_{file_date}_{start_date}_{end_date}.json')
    SSO_dict={}
    captured_date=day_light_saving().strftime('%Y-%m-%dT%H:%M:%SZ')
    for point_block_sso in point_list_SSO['data']:
        Date = point_block_sso['applicableFor']
        Value = point_block_sso['value']
        DataType = point_block_sso['itemName']
        # print('DataType: ',DataType,'Value: ',Value,'Date: ',Date)
        if DataType not in SSO_dict:
            SSO_dict[DataType]={}
            
        SSO_dict[DataType][Date]=Value
        
    for day in range(start_day,end_day):
        period_from = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 05:00:00.000')
        period_to = (datetime.datetime.strptime(period_from,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S.000')
        start_date_write = (day_light_saving()+datetime.timedelta(days=day+1)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d/%m/%Y')
        ##################Internal demand#########################
        
        Injection = SSO_dict['Storage, Daily Aggregated Inflows, D+1'].get(start_date_write,'')
        Withdrawl = SSO_dict['Storage, Daily Aggregated Outflows, D+1'].get(start_date_write,'')
        Inventory = SSO_dict['Storage, Daily Aggregated Stock level, D+1'].get(start_date_write,'')
        
        ##########################################################
        if period_from == '2023-10-07 05:00:00.000' or period_from == '2024-04-13 05:00:00.000' or period_from == '2024-04-14 05:00:00.000' or period_from == '2024-06-28 05:00:00.000'  or period_from == '2024-06-29 05:00:00.000' :
            continue
        elif Inventory == '':
            ssowh.write(f'National Gas|Aggregated Storage GB|{period_from}|{period_to}|gas-day|{gas_hour}|{captured_date}||Missing|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||New\n')    
        else:
            ssowh.write(f'National Gas|Aggregated Storage GB|{period_from}|{period_to}|gas-day|{gas_hour}|{captured_date}||Provisional||||||||||||||||||||||||||||{Inventory}|Kwh||||||||||||||||||||||||||{Injection}|Kwh||||||||{Withdrawl}|Kwh||||||||New\n')
        ##########################################################


def get_production_data(start_day,end_day):
    start_date = datetime.datetime.strptime((day_light_saving()+datetime.timedelta(days=start_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 00:00:00'),'%Y-%m-%d %H:%M:%S')
    end_date = datetime.datetime.strptime((day_light_saving()+datetime.timedelta(days=end_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 00:00:00'),'%Y-%m-%d %H:%M:%S')
    today_date = day_light_saving().strftime('%Y-%m-%d')
    epochtime = int(datetime.datetime.timestamp(datetime.datetime.now())*1000)
    captured_date=day_light_saving().strftime('%Y-%m-%dT%H:%M:%SZ')
    ######################################################################
    
    obj = sess.get('https://data.nationalgas.com/api/gas-data-reports-folders',headers={'Accept':'application/json, text/plain, */*','Connection':'keep-alive','Host':'data.nationalgas.com','Referer': 'https://data.nationalgas.com/reports/find-gas-reports','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36','traceparent': '00-132b2a4747084ce890be45a04a7f4bfc-4d703784879944e7-01'})

    with open('production_home_content.html','wb') as fh:
        fh.write(obj.content)
        print(obj.status_code)

    ##############################################################
    Production={}
    for day in range(start_day,end_day):
    
        start_date_ldz = datetime.datetime.strptime((day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 00:00:00'),'%Y-%m-%d %H:%M:%S')
        start_date = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d/%m/%Y')
        start_date_filename = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d-%m-%Y')
        ############################ Entry ####################################
        payload ={"reportName":"NTS Physical Entry End Of Day (NTSEOD)","gasDay":str(start_date_ldz)}
        
        obj = sess.post('https://data.nationalgas.com/api/reports',json=payload,headers={'Accept': 'application/json, text/plain, */*','Content-Type': 'application/json','Connection': 'keep-alive','traceparent': '00-1d78b05a6fc54defbf6eba0c8e665429-060b25ab9d424ffe-01','Host': 'data.nationalgas.com','Referer': 'https://data.nationalgas.com/reports/find-gas-reports/view','Request-Id': '|1d78b05a6fc54defbf6eba0c8e665429.060b25ab9d424ffe','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'})
        
        # with open(f'{cache_path}NationalGrid_detail_content_Production_{file_date}_{start_date_filename}.json','wb') as fh:
        with open(f'{cache_path_production}NationalGrid_detail_content_Production_{file_date}_{start_date_filename}.json','wb') as fh:
        # with open(f'NationalGrid_detail_content_Production_{file_date}_{start_date_filename}.json','wb') as fh:
            fh.write(obj.content)
        print(obj.status_code)    
        totalblock=safe_json_response(obj, {}, 'production total block')
        # try:
        # Production_Data_entry = totalblock['tableData'][0]['data']
        # {"tableData":["data":""]}
        try:
            Production_Data_entry = totalblock.get('tableData',[{}])[0].get('data',{})
        except:
            Production_Data_entry = {}
        # except:
            # pass
        for point_block_production in Production_Data_entry:
            IPs = point_block_production['System Entry Name']
            IPs=re.sub('\s+(?:Entry|Exit)$','',IPs,flags=re.I)
            Energy = point_block_production['System Entry Energy, EOD (kWh)']
            volume = point_block_production['System Entry Volume, EOD (mscm)']
            gcv = point_block_production['System Entry CV (MJ/scm)']
            
            if IPs not in Production:
                Production[IPs]={}
                
            if start_date_filename not in Production[IPs]:
                Production[IPs][start_date_filename]={}
                
            Production[IPs][start_date_filename]['Entry_Energy']=Energy
            Production[IPs][start_date_filename]['Entry_Volume']=volume
            Production[IPs][start_date_filename]['Entry_GCV']=gcv

        ######################################################################    
    # print(Production)
    for operator in config_data['production']['operator_points']:
        for point_name in config_data['production']['operator_points'][operator]:
            for day in range(start_day,end_day):
                period_from = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 05:00:00.000')
                period_to = (datetime.datetime.strptime(period_from,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d 05:00:00.000')
                date = datetime.datetime.strptime(period_from,'%Y-%m-%d %H:%M:%S.%f').strftime('%d-%m-%Y')
                try:
                    total_energy=Production[config_data['production']['point_mapping'][point_name]][date].get('Entry_Energy','')
                    total_valoume=Production[config_data['production']['point_mapping'][point_name]][date].get('Entry_Volume','')
                except:
                    total_energy=total_valoume=''
                total_energy_unit='Kwh'

                if (point_name=='STFergus-Shell' or point_name == 'St Fergus-NSMP'):
                    try:
                        GCV_value= Production[config_data['production']['point_mapping'][point_name]][date].get('Entry_GCV',39.424) ###default gcv
                    except:
                        GCV_value = 39.424
                    if ((total_valoume == 0 or total_valoume == '') and total_energy != 0 and total_energy != ''):
                        total_valoume = (float(total_energy)/(GCV_value*0.27777777778))/1000000
                    total_energy=''
                    total_energy_unit=''
                else:
                    GCV_value = config_data['production']['point_mapping_GCV'][point_name][1]
                # input(GCV_value)
                
                state = 'Provisional'
                if total_energy=='' and total_valoume=='':
                    state = 'Missing'
                data_status = 'New'
                if point_name=='STFergus-Shell' or point_name=='St Fergus-NSMP':
                    data_status = 'D-1'
                if not (((point_name == 'Teesside CATS') and (period_from=='2023-11-20 05:00:00.000')) or ((point_name=='St Fergus-NSMP')and((period_from == '2024-04-13 05:00:00.000')or(period_from == '2024-04-19 05:00:00.000'))) or ((point_name=='Bacton Other')and(period_from == '2024-09-25 05:00:00.000'))):
                    prodwh.write(f'{operator}|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|{captured_date}||{state}|H|{total_energy}|{total_energy_unit}||{total_valoume}|mscm||{GCV_value}|MJ/SCM|{data_status}\n')    
    
    ##########################    Production - Intra Day Starts#############
    obj = sess.get('https://data.nationalgas.com/api/customisable-downloads-locations',headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'})
    with open(f'{cache_path_production}Production_Intraday_IP_List_{file_date}.json','wb') as fh:
        fh.write(obj.content)
    ip_id_list=safe_json_response(obj, {}, 'production intraday IP list')
    point_mapping={"Barrow Terminal":{"entry":"BARROW TERMINAL","exit":""},"Easington - York":{"entry":"","exit":""},"Bacton Other":{"entry":"BACTON PERENCO","exit":""},"Rough production":{"entry":"EASINGTON ROUGH ST","exit":""},"Bacton SEAL":{"entry":"BACTON SEAL","exit":""},"Bacton SHELL":{"entry":"BACTON SHELL","exit":""},"Easington Dimlington":{"entry":"EASINGTON DIMLINGTON","exit":""},"St Fergus-NSMP":{"entry":"ST FERGUS NSMP","exit":""},"STFergus-Mobil":{"entry":"ST FERGUS MOBIL","exit":""},"STFergus-Shell":{"entry":"ST FERGUS SHELL","exit":""},"Teesside CATS" :{"entry":"TEESSIDE CATS","exit":""},"Teesside PX":{"entry":"TEESSIDE PX","exit":""}}
    all_points_hourly_value={}
    while start_day<end_day:
        s=start_day
        e=start_day+2
        if e>end_day:
            e=end_day
        start_date = (day_light_saving()+datetime.timedelta(days=s-1)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
        end_date = (day_light_saving()+datetime.timedelta(days=e)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
        while True:
            try:
                obj = sess.post('https://data.nationalgas.com/api/customisable-downloads-download?',json={"ids":"552,539,559,549,575,582,589,541,540,542,561","fromDate":start_date,"toDate":end_date,"isLatest":True,"type":"CSV"},headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36','Referer':'https://data.nationalgas.com/reports/customisable-downloads'})
                file_name = f'Production_Intraday_detail_content_{start_date}_{end_date}_{file_date}.csv'
                with open(file_name,'wb') as fh:
                    fh.write(obj.content)
                
                output_data = pd.read_csv(file_name,index_col=False)
                output_data = output_data.sort_values(by=['System Entry Name','Timestamp'])
                shutil.move(file_name,cache_path_production)
                break
            except:
                os.remove(file_name)
        # all_points_hourly_value = defaultdict(dict)
        start_day+=2
        total_hours = 1
        total_values = 0
        prev_hour = 0
        flag=0
        prev_ip_name=''

        for row_num, row_data in enumerate(output_data.values):
            date_hour = row_data[3]
            ip_name = row_data[0]
            value = row_data[2]
            org_date_hour = date_hour
            if prev_ip_name!=ip_name:
                flag=0
            prev_ip_name=ip_name
            current_hour = datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S').hour
            current_minute = datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S').minute
            temp_date_hour = datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S').strftime('%Y-%m-%d %H:15:00.000')
            if current_hour!=5 and flag==0:
                continue
            flag=1
            if current_hour==4 and current_minute>15:
                continue
            if ((current_hour==5 and current_minute>15) or (current_hour>5) or (current_hour<4) or (current_hour==4 and current_minute<=15)):
                current_hour = (datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S')+datetime.timedelta(minutes=45)).hour
                temp_date_hour = (datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S')+datetime.timedelta(minutes=45)).strftime('%Y-%m-%d %H:15:00.000')
            date_hour=temp_date_hour
            # input()
            if current_hour==5 and prev_hour!=current_hour:
                total_values = 0
                total_hours = 0
            prev_hour=current_hour
            if date_hour not in all_points_hourly_value:
                all_points_hourly_value[date_hour]={}
            if ip_name not in all_points_hourly_value:
                all_points_hourly_value[date_hour][ip_name]={}
            total_values+=float(value)
            total_hours+=1
            all_points_hourly_value[date_hour][ip_name]['value']=total_values
            all_points_hourly_value[date_hour][ip_name]['average']=total_hours
            # print(f'date_hour : {date_hour}  :  {org_date_hour}  :  {total_values}  :  {ip_name}')
    for period_to in all_points_hourly_value.keys():
        # input()
        # period_from = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')-datetime.timedelta(minutes=315)).strftime('%Y-%m-%d %H:%M:%S.%f')
        period_from = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')-datetime.timedelta(minutes=315)).strftime('%Y-%m-%d 05:00:00.000')
        gh = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')-datetime.timedelta(hours=5)).hour+1
        #############ak################
        period_from_new = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')).strftime('%Y-%m-%d %H:00:00.000')
        period_to_new = (datetime.datetime.strptime(period_from_new,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(hours=1)).strftime('%Y-%m-%d %H:00:00.000')
        #############################
        for point_name in point_mapping:
            state = 'Provisional'
            entry_volume = all_points_hourly_value[period_to].get(point_mapping[point_name]['entry'],{}).get('value','')
            if entry_volume=='' :
                state = 'Missing'
            if entry_volume!='':
                entry_volume = entry_volume/all_points_hourly_value[period_to].get(point_mapping[point_name]['entry'],{}).get('average',1)
            data_status = 'New'
            if point_name=='STFergus-Shell' or point_name=='St Fergus-NSMP':
                data_status = 'D-1'
            GCV_value= config_data['production']['point_mapping_GCV'][point_name][1]    
            prodwh.write(f'National Gas|{point_name}|{period_from}|{period_to}|intra-day|{gh}|{captured_date}||{state}|H||||{entry_volume}|mscm||{GCV_value}|MJ/SCM|{data_status}\n')
    ##########################    Production - Intra Day Ends####################

def get_gasflow_data(start_day,end_day):
    start_date = datetime.datetime.strptime((day_light_saving()+datetime.timedelta(days=start_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 00:00:00'),'%Y-%m-%d %H:%M:%S')
    end_date = datetime.datetime.strptime((day_light_saving()+datetime.timedelta(days=end_day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 00:00:00'),'%Y-%m-%d %H:%M:%S')
    today_date = day_light_saving().strftime('%Y-%m-%d')
    epochtime = int(datetime.datetime.timestamp(datetime.datetime.now())*1000)
    captured_date=day_light_saving().strftime('%Y-%m-%dT%H:%M:%SZ')
    ######################################################################
    
    obj = sess.get('https://data.nationalgas.com/api/gas-data-reports-folders',headers={'Accept':'application/json, text/plain, */*','Connection':'keep-alive','Host':'data.nationalgas.com','Referer': 'https://data.nationalgas.com/reports/find-gas-reports','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36','traceparent': '00-132b2a4747084ce890be45a04a7f4bfc-4d703784879944e7-01'})

    with open('Gasflow_home_content.html','wb') as fh:
        fh.write(obj.content)
        print(obj.status_code)

    ##############################################################
    Gasflow={}
    obj = sess.get('https://extranet.nationalgrid.com/Grain/api/grain/getGrainCurrentYearData?_=1690983567225',headers={'Upgrade-Insecure-Requests':'1','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'})
    with open(f'{cache_path_gasflow}Gasflow_Grain_Content.json','wb') as fh:
        fh.write(obj.content)
    grain_data=defaultdict(dict)
    months = {'January':1,'February':2,'March':3,'April':4,'May':5,'June':6,'July':7,'August':8,'September':9,'October':10,'November':11,'December':12}
    for date_data in safe_json_response(obj, {}, 'Grain current year data').get('aaData', []):
        grain_data[months[date_data['GasMonth']]][date_data['GasDay']]=date_data['AggregateSendOut']
    for day in range(start_day,end_day):
    
        start_date_ldz = datetime.datetime.strptime((day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 00:00:00'),'%Y-%m-%d %H:%M:%S')
        start_date = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d/%m/%Y')
        start_date_filename = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%d-%m-%Y')
        ############################ Entry ####################################
        payload ={"reportName":"NTS Physical Entry End Of Day (NTSEOD)","gasDay":str(start_date_ldz)}
        
        obj = sess.post('https://data.nationalgas.com/api/reports',json=payload,headers={'Accept': 'application/json, text/plain, */*','Content-Type': 'application/json','Connection': 'keep-alive','traceparent': '00-1d78b05a6fc54defbf6eba0c8e665429-060b25ab9d424ffe-01','Host': 'data.nationalgas.com','Referer': 'https://data.nationalgas.com/reports/find-gas-reports/view','Request-Id': '|1d78b05a6fc54defbf6eba0c8e665429.060b25ab9d424ffe','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'})
        print(obj.status_code)
        # input()
        # with open(f'{cache_path}NationalGrid_detail_content_LDZ{file_date}_{start_date_filename}.json','wb') as fh:
        with open(f'{cache_path_gasflow}NationalGrid_detail_content_Gasflow_Entry_{file_date}_{start_date_filename}.json','wb') as fh:
        # with open(f'NationalGrid_detail_content_Gasflow_Entry_{file_date}_{start_date_filename}.json','wb') as fh:
            fh.write(obj.content)
            print(obj.status_code)    
        totalblock=safe_json_response(obj, {}, f'gasflow entry report for {start_date_filename}')
        try:
            Gasflow_Data_entry =  totalblock.get('tableData',[{}])[0].get('data',{})
        except:
            Gasflow_Data_entry= {}
        
        for point_block_gasflow in Gasflow_Data_entry:
            IPs = point_block_gasflow.get('System Entry Name','')
            if IPs=='':
                continue
            IPs=re.sub('\s+(?:Entry|Exit)$','',IPs,flags=re.I)
            Energy = point_block_gasflow['System Entry Energy, EOD (kWh)']
            volume = point_block_gasflow['System Entry Volume, EOD (mscm)']
            gcv = point_block_gasflow['System Entry CV (MJ/scm)']
            
            if IPs not in Gasflow:
                Gasflow[IPs]={}
            if start_date_filename not in Gasflow[IPs]:
                Gasflow[IPs][start_date_filename]={}
            Gasflow[IPs][start_date_filename]['Entry_Energy']=Energy
            Gasflow[IPs][start_date_filename]['Entry_Volume']=volume
            Gasflow[IPs][start_date_filename]['Entry_gcv']=gcv

        ######################################################################    
        ############################## Exit ##################################
        payload ={"reportName":"Actual Offtake Flows (AOF)","gasDay":str(start_date_ldz)}
        
        obj = sess.post('https://data.nationalgas.com/api/reports',json=payload,headers={'Accept': 'application/json, text/plain, */*','Content-Type': 'application/json','Connection': 'keep-alive','traceparent': '00-b176a9175043493b939b489c9b4887ea-6a5f756283c04c61-01','Host': 'data.nationalgas.com','Referer': 'https://data.nationalgas.com/reports/find-gas-reports/view','Request-Id': '|b176a9175043493b939b489c9b4887ea.6a5f756283c04c61','User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'})
        
        # with open(f'{cache_path}NationalGrid_detail_content_LDZ{file_date}_{start_date_filename}.json','wb') as fh:
        with open(f'{cache_path_gasflow}NationalGrid_detail_content_Gasflow_Exit_{file_date}_{start_date_filename}.json','wb') as fh:
        # with open(f'NationalGrid_detail_content_Gasflow_Exit_{file_date}_{start_date_filename}.json','wb') as fh:
            fh.write(obj.content)
            print(obj.status_code)    
        totalblock=safe_json_response(obj, {}, f'gasflow exit report for {start_date_filename}')
        try:
        # Gasflow_Data_exit = totalblock['tableData'][0]['data']
            Gasflow_Data_exit = totalblock.get('tableData',[{}])[0].get('data',{})
        except:
            Gasflow_Data_exit={}
        for point_block_gasflow in Gasflow_Data_exit:
            IPs = point_block_gasflow.get('Site Name','')
            if IPs=='':
                continue
            IPs=re.sub('\s+(?:Entry|Exit)$','',IPs,flags=re.I)
            Energy = point_block_gasflow['Energy(kWh)']
            volume = point_block_gasflow['Total Physical flows(mscm)']
            # Gasflow_Data_exit = totalblock['tableData'][0]['data']
            try:
                Gasflow_Data_exit = totalblock.get('tableData',[{}])[0].get('data',{})
            except:
                Gasflow_Data_exit = {}
            if IPs not in Gasflow:
                Gasflow[IPs]={}
            if start_date_filename not in Gasflow[IPs]:
                Gasflow[IPs][start_date_filename]={}
            Gasflow[IPs][start_date_filename]['Exit_Energy']=Energy
            Gasflow[IPs][start_date_filename]['Exit_Volume']=volume
        date = datetime.datetime.strptime(start_date_filename,'%d-%m-%Y').day
        month = datetime.datetime.strptime(start_date_filename,'%d-%m-%Y').month
        print(f'{date}/{month}')
        if 'Grain' not in Gasflow:
            Gasflow['Grain']=defaultdict(dict)
        Gasflow['Grain'][start_date_filename]['Entry_Energy']=grain_data.get(month,{}).get(date,'')
        
        ##################################################################
    # print(Gasflow)
    for operator in config_data['gas-flow']['operator_points']:
        for point_name in config_data['gas-flow']['operator_points'][operator]:
            for day in range(start_day,end_day):
                period_from = (day_light_saving()+datetime.timedelta(days=day)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d 05:00:00.000')
                period_to = (datetime.datetime.strptime(period_from,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d 05:00:00.000')
                date = datetime.datetime.strptime(period_from,'%Y-%m-%d %H:%M:%S.%f').strftime('%d-%m-%Y')
                entry_energy=Gasflow.get(config_data['gas-flow']['point_mapping'][point_name],{}).get(date,{}).get('Entry_Energy','')
                entry_volume=Gasflow.get(config_data['gas-flow']['point_mapping'][point_name],{}).get(date,{}).get('Entry_Volume','')
                entry_gcv=Gasflow.get(config_data['gas-flow']['point_mapping'][point_name],{}).get(date,{}).get('Entry_gcv','')
                entry_gcv_unit = 'MJ/SCM'
                if entry_gcv == '':
                    entry_gcv = 10.76
                    entry_gcv_unit = 'kWh/Sm3'
                if ((point_name == 'St Fergus-NSMP' or point_name=='STFergus-Shell') and (entry_volume == 0 or entry_volume == '') and entry_energy!= 0 and entry_energy!= ''):
                    if entry_gcv == 10.76 :
                        entry_volume=(entry_energy/entry_gcv)/1000000    
                    else:
                        entry_volume=((entry_energy/(entry_gcv*0.27777777778))/1000000)
                        
                exit_energy=Gasflow.get(config_data['gas-flow']['point_mapping'][point_name],{}).get(date,{}).get('Exit_Energy','')
                exit_volume=Gasflow.get(config_data['gas-flow']['point_mapping'][point_name],{}).get(date,{}).get('Exit_Volume','')
                state = 'Provisional'
                if entry_energy=='' and entry_volume=='' and exit_energy=='' and exit_volume=='':
                    state = 'Missing'
                data_status = 'New'
                if point_name=='STFergus-Shell' or point_name=='St Fergus-NSMP':
                    data_status = 'D-1'
                
                if point_name=='Grain':
                    tsowh.write(f'{operator}|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|gas-flow|{captured_date}||{state}|{entry_energy}|KWH|||||39.00|MJ/Scm|||||||||||||||||{data_status}\n')
                else:
                    if ((point_name=='Milford Haven - Dragon')and((period_from == '2023-10-01 05:00:00.000')or(period_from == '2024-05-24 05:00:00.000'))) or ((point_name=='Moffat Interconnector')and(period_from == '2024-02-06 05:00:00.000')or(period_from == '2024-04-29 05:00:00.000')) or ((point_name=='St Fergus-NSMP')and((period_from == '2024-04-13 05:00:00.000')or(period_from == '2024-04-19 05:00:00.000')))or ((point_name=='Easington-Langeled')and(period_from == '2024-06-23 05:00:00.000')) or  ((point_name=='Bacton Interconnector')and(period_from == '2024-09-25 05:00:00.000')):
                        pass
                    else:
                        if (point_name == 'STFergus-Shell' or point_name == 'St Fergus-NSMP'): ###with gcv 
                             tsowh.write(f'{operator}|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|gas-flow|{captured_date}||{state}|{entry_energy}|KWH||{entry_volume}|mscm||{entry_gcv}|{entry_gcv_unit}|{exit_energy}|KWH||{exit_volume}|mscm||||||||||||{data_status}\n')
                        else: ###without gcv
                            tsowh.write(f'{operator}|{point_name}|{period_from}|{period_to}|gas-day|{gas_hour}|gas-flow|{captured_date}||{state}|{entry_energy}|KWH||{entry_volume}|mscm||||{exit_energy}|KWH||{exit_volume}|mscm||||||||||||{data_status}\n')
                    if point_name == 'Bacton BBL Interconnector':
                        tsowh.write(f'Gasunie Transport Services|Julianadorp (BBL)|{period_from}|{period_to}|gas-day|{gas_hour}|gas-flow|{captured_date}||{state}|{exit_energy}|KWH||{exit_volume}|mscm||||{entry_energy}|KWH||{entry_volume}|mscm||||||||||||{data_status}\n')
    #########################    Gasflow Intra Day
    obj = sess.get('https://data.nationalgas.com/api/customisable-downloads-locations',headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'})
    with open(f'{cache_path_gasflow}Intraday_IP_List_{file_date}.json','wb') as fh:
        fh.write(obj.content)
    ip_id_list=safe_json_response(obj, {}, 'intraday IP list')
    linepack_hourly_value = {}
    all_points_hourly_value={}
    point_mapping={"Hill Top Farm":{"entry":"HILLTOP","exit":""},"STFergus-Shell":{"entry":"ST FERGUS SHELL","exit":""},"Bacton BBL Interconnector":{"entry":"BACTON BBL","exit":"Bacton BBL Export"},"Aldbrough":{"entry":"ALDBROUGH","exit":""},"Stublach":{"entry":"STUBLACH","exit":""},"St Fergus-NSMP":{"entry":"ST FERGUS NSMP","exit":""},"Milford Haven - South Hook":{"entry":"MILFORD HAVEN - SOUTH HOOK","exit":""},"Bacton Interconnector":{"entry":"BACTON IC","exit":"Bacton INT Export"},"Holford":{"entry":"HOLFORD","exit":""},"Milford Haven - Dragon":{"entry":"MILFORD HAVEN - DRAGON","exit":""},"Moffat Interconnector":{"entry":"","exit":"Moffat Export"},"Rough":{"entry":"EASINGTON ROUGH ST","exit":""},"Hole House Farm":{"entry":"HOLE HOUSE FARM","exit":""},"Easington-Langeled":{"entry":"EASINGTON LANGELED","exit":""},"Hornsea":{"entry":"HORNSEA","exit":""},"Interconnector Export Demand flow":{"entry":"","exit":"Interconnector Export Demand Flow"},"Storage Demand flow":{"entry":"","exit":"Storage Demand Flow"},"Linepack":{"entry":"NTS Actual Linepack","exit":""}}
    while start_day<end_day:
        s=start_day
        e=start_day+2
        if e>end_day:
            e=end_day
        start_date = (day_light_saving()+datetime.timedelta(days=s-1)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
        end_date = (day_light_saving()+datetime.timedelta(days=e)+datetime.timedelta(hours=config_data['hours_add_sub'])).strftime('%Y-%m-%d')
        print(f'start_date  ::  {start_date}, end_date  ::  {end_date}')
        while True:
            try:
                obj = sess.post('https://data.nationalgas.com/api/customisable-downloads-download?', json={"ids":"601,602,585,586,583,603,584,587,572,570,579,582,560,563,571,568,541,540,562,576,578,573,544,577,591","fromDate":start_date,"toDate":end_date,"isLatest":True,"type":"CSV"},headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36','Referer':'https://data.nationalgas.com/reports/customisable-downloads'})
                file_name = f'Gasflow_Intraday_detail_content_{start_date}_{end_date}_{file_date}.csv'
                with open(file_name,'wb') as fh:
                    fh.write(obj.content)
                output_data = pd.read_csv(file_name,index_col=False)
                output_data = output_data.sort_values(by=['System Entry Name','Timestamp'])
                shutil.move(file_name,cache_path_gasflow)
                break
            except:
                print('Gasflow intraday content fetch retry')
                time.sleep(30)
                os.remove(file_name)
                
        start_day+=2
        total_hours = 1
        total_values = 0
        prev_hour = 0
        flag=0
        prev_ip_name=''
        
        for row_num, row_data in enumerate(output_data.values):
            date_hour = row_data[3]
            ip_name = row_data[0]
            value = row_data[2]
            org_date_hour = date_hour
            # print(f'date_hour::{date_hour} = = {ip_name} ')
            # input('datehourcomplete')
            if prev_ip_name!=ip_name:
                flag=0
            prev_ip_name=ip_name
            current_hour = datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S').hour
            current_minute = datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S').minute
            temp_date_hour = datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S').strftime('%Y-%m-%d %H:15:00.000')
            # print(f'temp_date_hour::{temp_date_hour}')
            # input('done')
            if current_hour!=5 and flag==0:
                # input('1st if')
                continue
            flag=1
            if current_hour==4 and current_minute>15:
                # input('2nd if')
                continue
            if ((current_hour==5 and current_minute>15) or (current_hour>5) or (current_hour<4) or (current_hour==4 and current_minute<=15)):
                current_hour = (datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S')+datetime.timedelta(minutes=45)).hour
                temp_date_hour = (datetime.datetime.strptime(date_hour,'%d/%m/%Y %H:%M:%S')+datetime.timedelta(minutes=45)).strftime('%Y-%m-%d %H:15:00.000')
                # print(f'temp_date_hour::{temp_date_hour}')
                # input('3rd if')
            date_hour=temp_date_hour
            # input()
            if current_hour==5 and prev_hour!=current_hour:
                total_values = 0
                total_hours = 0
            prev_hour=current_hour
            if date_hour not in all_points_hourly_value:
                all_points_hourly_value[date_hour]={}
            if ip_name not in all_points_hourly_value:
                all_points_hourly_value[date_hour][ip_name]={}
            total_values+=float(value)
            total_hours+=1
            all_points_hourly_value[date_hour][ip_name]['value']=total_values
            all_points_hourly_value[date_hour][ip_name]['average']=total_hours
            # print(all_points_hourly_value[date_hour][ip_name]['value'])
            # print(all_points_hourly_value[date_hour][ip_name]['average'])
            # print(f'{date_hour} all done')
            # input('all done')

    for period_to in all_points_hourly_value.keys():
        # input()
        # period_from = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')-datetime.timedelta(minutes=315)).strftime('%Y-%m-%d %H:%M:%S.%f')
        period_from = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')-datetime.timedelta(minutes=315)).strftime('%Y-%m-%d 05:00:00.000')
        gh = datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f').hour-1
        #############ak################
        period_from_new = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')).strftime('%Y-%m-%d %H:00:00.000')
        period_to_new = (datetime.datetime.strptime(period_from_new,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(hours=1)).strftime('%Y-%m-%d %H:00:00.000')
        # #############################
        # hour_temp_date=day_light_saving().strftime('%Y-%m-%d')    
        # period_temp_date = datetime.datetime.strptime(period_to, '%Y-%m-%d %H:%M:%S.%f')
        # period_temp_date_minus_one_day = period_temp_date - datetime.timedelta(days=1)
        # period_date = period_temp_date_minus_one_day.date()
        # period_temp_date_str = period_date.strftime('%Y-%m-%d')

        # print(f'period_to=={period_temp_date_str}')    
        # print(f'hour_temp_date=={hour_temp_date}') 
        # input()            
        # if(hour_temp_date == period_temp_date_str):
        for point_name in point_mapping:
            state = 'Provisional'
            # print(point_name)
            entry_volume = all_points_hourly_value[period_to].get(point_mapping[point_name]['entry'],{}).get('value','')
            exit_volume = all_points_hourly_value[period_to].get(point_mapping[point_name]['exit'],{}).get('value','')
            if entry_volume=='' and exit_volume=='':
                state = 'Missing'
            if entry_volume!='':
                entry_volume = entry_volume/all_points_hourly_value[period_to].get(point_mapping[point_name]['entry'],{}).get('average',1)
            if exit_volume!='':
                exit_volume = exit_volume/all_points_hourly_value[period_to].get(point_mapping[point_name]['exit'],{}).get('average',1)
            data_status = 'New'
            if point_name=='STFergus-Shell' or point_name=='St Fergus-NSMP':
                data_status = 'D-1'
            ########################################################################################    
            # hour_temp_date=day_light_saving().strftime('%Y-%m-%d')    
            # period_temp_date = datetime.datetime.strptime(period_from, '%Y-%m-%d %H:%M:%S.%f')
            # period_temp_date_minus_one_day = period_temp_date - datetime.timedelta(days=0)
            # period_date = period_temp_date_minus_one_day.date()
            # period_temp_date_str = period_date.strftime('%Y-%m-%d')
            # # print(f'period_to=={period_temp_date_str}')    
            # # print(f'hour_temp_date=={hour_temp_date}') 
            # # input('done')            
            ########################################################################################    
            # if(hour_temp_date == period_temp_date_str):
                # input('enter')            
            if ((point_name == 'Linepack')or(point_name == 'Predicted Closing Linepack')): 
                tsowh.write(f'National Gas|{point_name}|{period_from_new}|{period_to_new}|intra-day|{gh}|gas-flow|{captured_date}||{state}||||{entry_volume}|mcm||{config_data["gas-flow"]["gcv"][point_name]}|MJ/Scm||||{exit_volume}|mscm||{config_data["gas-flow"]["gcv"][point_name]}|MJ/Scm|||||||||{data_status}\n')
            else:    
            
                tsowh.write(f'National Gas|{point_name}|{period_from}|{period_to}|intra-day|{gh}|gas-flow|{captured_date}||{state}||||{entry_volume}|mcm||{config_data["gas-flow"]["gcv"][point_name]}|MJ/Scm||||{exit_volume}|mscm||{config_data["gas-flow"]["gcv"][point_name]}|MJ/Scm|||||||||{data_status}\n')
            if point_name=='Linepack':
                linepack_hourly_value[period_from_new]=entry_volume
        entry_volume = ''
        state='Provisional'
        if all_points_hourly_value[period_to].get('GRAIN NTS 1',{}).get('value','')=='' and all_points_hourly_value[period_to].get('GRAIN NTS 2',{}).get('value','')=='':
            state='Missing'
        else:
            entry_volume=all_points_hourly_value[period_to].get('GRAIN NTS 1',{}).get('value',0)+all_points_hourly_value[period_to].get('GRAIN NTS 2',{}).get('value',0)
            avg_entry_volume=all_points_hourly_value[period_to].get('GRAIN NTS 1',{}).get('average',1)+all_points_hourly_value[period_to].get('GRAIN NTS 2',{}).get('average',1)
            final_entry_volume = entry_volume/avg_entry_volume
        hour_temp_date=day_light_saving().strftime('%Y-%m-%d')    
        period_temp_date = datetime.datetime.strptime(period_from, '%Y-%m-%d %H:%M:%S.%f')
        period_temp_date_minus_one_day = period_temp_date - datetime.timedelta(days=1)
        period_date = period_temp_date_minus_one_day.date()
        period_temp_date_str = period_date.strftime('%Y-%m-%d')
        ########################################################################################    
        if(hour_temp_date == period_temp_date_str):    
            tsowh.write(f'National Gas|Grain|{period_from}|{period_to}|intra-day|{gh}|gas-flow|{captured_date}||{state}||||{final_entry_volume}|mscm||{config_data["gas-flow"]["gcv"]["Grain"]}|MJ/Scm|||||||||||||||||New\n')
    while True:
        try:
            # Predicted closing linepack data is also available in "https://data.nationalgas.com/gas-system-status" url. If the below url is not working, change the url
            obj = sess.post('https://data.nationalgas.com/api/find-gas-data',json={"latestFlag":"Y","applicableFor":"Y","dateTo":end_date,"dateFrom":start_date,"dateType":"GASDAY","ids":"PUBOB30"},headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36','Referer':'https://data.nationalgas.com/find-gas-data/view','Content-Type':'application/json'})
            with open(f'{cache_path_gasflow}Gasflow_linepack_intraday_content_{file_date}.json','wb') as fh:
                fh.write(obj.content)
            linepack_intraday_data = safe_json_response(obj, {'data': []}, 'linepack intraday data')
            break
        except:
            time.sleep(30)
            print('Linepack intraday content fetch retry')
            os.remove(f'{cache_path_gasflow}Gasflow_linepack_intraday_content_{file_date}.json')
    for linepack_block in linepack_intraday_data['data']:
        # period_to = (datetime.datetime.strptime(linepack_block['applicableAt'],'%d/%m/%Y %H:%M:%S')-datetime.timedelta(hours=1)).strftime('%Y-%m-%d %H:15:00.000')
        period_to = (datetime.datetime.strptime(linepack_block['applicableAt'],'%d/%m/%Y %H:%M:%S')-datetime.timedelta(hours=1)).strftime('%Y-%m-%d %H:00:00.000')
        period_from = (datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f')-datetime.timedelta(hours=1)).strftime('%Y-%m-%d %H:00:00.000')
        gh = datetime.datetime.strptime(period_to,'%Y-%m-%d %H:%M:%S.%f').hour-1
        # print(f'{period_from}  ::  {linepack_block["itemName"]}  ::  {linepack_block["value"]}')
        entry_volume=linepack_block["value"]
        ##############################################
        hour_temp_date=day_light_saving().strftime('%Y-%m-%d')    
        period_temp_date = datetime.datetime.strptime(period_from, '%Y-%m-%d %H:%M:%S.%f')
        period_temp_date_minus_one_day = period_temp_date - datetime.timedelta(days=0)
        period_date = period_temp_date_minus_one_day.date()
        period_temp_date_str = period_date.strftime('%Y-%m-%d')
        ########################################################################################    
        if(hour_temp_date == period_temp_date_str):
            tsowh.write(f'National Gas|Predicted Closing Linepack|{period_from}|{period_to}|intra-day|{gh}|gas-flow|{captured_date}||Provisional||||{entry_volume}|mcm||{config_data["gas-flow"]["gcv"]["Linepack"]}|MJ/Scm|||||||||||||||||New\n')
            # print(entry_volume)
            # print(type(entry_volume))
            # print(linepack_hourly_value.get(period_from,0))
            if period_from in linepack_hourly_value:
                linepack_variation = float(entry_volume)-linepack_hourly_value.get(period_from,0)
                if linepack_variation<0:
                    linepack_variation*=-1
                    tsowh.write(f'National Gas|Linepack Variation|{period_from}|{period_to}|intra-day|{gh}|gas-flow|{captured_date}||Provisional||||||||||||{linepack_variation}|mcm||{config_data["gas-flow"]["gcv"]["Linepack"]}|MJ/Scm|||||||||New\n')
                else:
                    tsowh.write(f'National Gas|Linepack Variation|{period_from}|{period_to}|intra-day|{gh}|gas-flow|{captured_date}||Provisional||||{linepack_variation}|mcm||{config_data["gas-flow"]["gcv"]["Linepack"]}|MJ/Scm|||||||||||||||||New\n')
    
    
if __name__=='__main__':
    sess = requests.Session()
    sess.headers['User-Agent']='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'

    config_data = json.load(open('Nationalgrid_config.json','r',encoding='utf-8'))
    if not config_data['script_run_status']:
        print('Script exit')
        sys.exit(1)    
    
    file_date = day_light_saving().strftime('%Y-%m-%dT%H%M%S')
    folder_date = day_light_saving().strftime('%Y-%m-%d')
    
    cache_path_demand = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['demand']['cache_path']))
    cache_path_sso = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['SSO']['cache_path']))
    cache_path_gasflow = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['gas-flow']['cache_path']))
    cache_path_nom = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['nomination']['cache_path']))
    cache_path_production = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['production']['cache_path']))
    
    demand_output_path = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['demand']['output_path']))
    SSO_output_path = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['SSO']['output_path']))
    Gasflow_output_path = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['gas-flow']['output_path']))
    nom_output_path = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['nomination']['output_path']))
    renom_output_path = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['renomination']['output_path']))
    Production_output_path = re.sub('<OPERATORID>',config_data['operator_id'],re.sub('<DATE>',folder_date,config_data['production']['output_path']))

    if not os.path.exists(cache_path_demand):
        os.makedirs(cache_path_demand)
    
    if not os.path.exists(cache_path_sso):
        os.makedirs(cache_path_sso)    
    
    if not os.path.exists(cache_path_gasflow):
        os.makedirs(cache_path_gasflow)
    
    if not os.path.exists(cache_path_nom):
        os.makedirs(cache_path_nom)
    
    if not os.path.exists(cache_path_production):
        os.makedirs(cache_path_production)
    
    if not os.path.exists(demand_output_path):
        os.makedirs(demand_output_path)    
    
    if not os.path.exists(SSO_output_path):
        os.makedirs(SSO_output_path)    

    if not os.path.exists(Production_output_path):
        os.makedirs(Production_output_path)
    
    if not os.path.exists(Gasflow_output_path):
        os.makedirs(Gasflow_output_path)

    if not os.path.exists(nom_output_path):
        os.makedirs(nom_output_path)
    
    if not os.path.exists(renom_output_path):
        os.makedirs(renom_output_path)
    
    gas_hour = (day_light_saving()+datetime.timedelta(hours=config_data['hours_add_sub'])).hour
    ###############################################################
    demand_output_file_name = '{}_TSO_Demand_NationalGrid_{}_{}.txt'.format(config_data['operator_id'],gas_hour,file_date)
    demwh = open(demand_output_file_name,'w',encoding='utf-8')
    demwh.write('|'.join(config_data['demand']['header'])+'\n')
    ###############################################################
    SSO_output_file_name = '{}_SSO_NationalGrid_{}_{}.txt'.format(config_data['operator_id'],gas_hour,file_date)
    ssowh = open(SSO_output_file_name,'w',encoding='utf-8')
    ssowh.write('|'.join(config_data['SSO']['header'])+'\n')
    ###############################################################
    ###############################################################
    Gasflow_output_file_name = '{}_Gasflow_NationalGrid_{}_{}.txt'.format(config_data['operator_id'],gas_hour,file_date)
    tsowh = open(Gasflow_output_file_name,'w',encoding='utf-8')
    tsowh.write('|'.join(config_data['gas-flow']['header'])+'\n')
    ###############################################################
    nom_output_file_name = '{}_Nomination_NationalGrid_{}_{}.txt'.format(config_data['operator_id'],gas_hour,file_date)
    nomwh = open(nom_output_file_name,'w',encoding='utf-8')
    nomwh.write('|'.join(config_data['nomination']['header'])+'\n')
    ###############################################################
    renom_output_file_name = '{}_Renomination_NationalGrid_{}_{}.txt'.format(config_data['operator_id'],gas_hour,file_date)
    renomwh = open(renom_output_file_name,'w',encoding='utf-8')
    renomwh.write('|'.join(config_data['renomination']['header'])+'\n')
    ###############################################################
    ###############################################################
    Production_output_file_name = '{}_Production_NationalGrid_{}_{}.txt'.format(config_data['operator_id'],gas_hour,file_date)
    prodwh = open(Production_output_file_name,'w',encoding='utf-8')
    prodwh.write('|'.join(config_data['production']['header'])+'\n')
    ###############################################################
    
    get_demand_data(config_data['demand']['start_day'],config_data['demand']['end_day'])
    get_sso_data(config_data['SSO']['start_day'],config_data['SSO']['end_day']) #issuelog 02-07-2024: operator stopped as of now. operator name change changed
    get_gasflow_data(config_data['gas-flow']['start_day'],config_data['gas-flow']['end_day'])
    get_nom_renom_data(config_data['nomination']['start_day'],config_data['nomination']['end_day'])
    get_production_data(config_data['production']['start_day'],config_data['production']['end_day'])
    demwh.close()
    ssowh.close()
    tsowh.close()
    nomwh.close()
    renomwh.close()
    prodwh.close()
    
    if config_data['demand']['output_move']:
        shutil.move(demand_output_file_name,demand_output_path)
        
    if config_data['SSO']['output_move']: #issuelog 02-07-2024: operator stopped as of now. operator name change changed
        shutil.move(SSO_output_file_name,SSO_output_path)
    
    if config_data['gas-flow']['output_move']:
        shutil.move(Gasflow_output_file_name,Gasflow_output_path)
    
    if config_data['nomination']['output_move']:
        shutil.move(nom_output_file_name,nom_output_path)
    
    if config_data['renomination']['output_move']:
        shutil.move(renom_output_file_name,renom_output_path)
    
    if config_data['production']['output_move']:
        shutil.move(Production_output_file_name,Production_output_path)
    
    
