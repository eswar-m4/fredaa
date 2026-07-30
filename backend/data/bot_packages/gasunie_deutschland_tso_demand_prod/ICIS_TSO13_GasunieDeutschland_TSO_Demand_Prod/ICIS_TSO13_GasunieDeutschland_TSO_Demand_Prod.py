import ICIS_Methods as pm
import traceback
import requests
import re
import json
import datetime,time
import time
import sys
import random
import pandas as pd
from unidecode import unidecode
from collections import defaultdict
import urllib.parse
from urllib.parse import quote
import shutil
now = datetime.datetime.utcnow() + datetime.timedelta(hours=1)

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
REQUEST_SESSION = requests.Session()
REQUEST_SESSION.trust_env = True
REQUEST_SESSION.headers.update({"User-Agent": DEFAULT_USER_AGENT})


def get_epoch_time():
    return str(int(time.time() * 1000000))[:13]

def get_content(url, method='GET', data=None, headers=None, max_retries=5, session=None):
    retries = 0
    sess = session or REQUEST_SESSION
    while retries < max_retries:
        try:
            if method == 'POST':
                response = sess.post(url, data=data, headers=headers, timeout=45, verify=False, allow_redirects=False)
            else:
                response = sess.get(url, headers=headers, timeout=45, verify=False, allow_redirects=False)

            status_code = response.status_code
            print(f"CODE :: {status_code}")

            if 200 <= status_code < 300:
                time.sleep(random.randint(1, 3))
                return unidecode(response.text)

            elif 300 <= status_code < 400:
                new_url = response.headers.get('Location')
                print(f"\nRedirecting to : {new_url}")
                url = requests.compat.urljoin(url, new_url)
                method = 'GET'

            elif 400 <= status_code < 500:
                print(f"\nClient Error: {url}")
                retries += 1
                time.sleep(10)

            elif 500 <= status_code < 600:
                print(f"\nServer Error: {url}")
                retries += 1
                time.sleep(120)

        except Exception as e:
            print(f"Error occurred: {e}")
            retries += 1
            time.sleep(10)

    raise Exception("Max retries reached")
    
def parse_value(val):
    try:
        return float(val.replace(',', '.'))
    except:
        return val
def convert_defaultdict_to_dict(d):

    if isinstance(d, defaultdict):
        d = {k: convert_defaultdict_to_dict(v) for k, v in d.items()}
    elif isinstance(d, dict):
        d = {k: convert_defaultdict_to_dict(v) for k, v in d.items()}
    return d
class ICIS_Class:
    
    def __init__(self, configData):
        self.sess = requests.Session()
        self.sess.trust_env = True
        self.sess.headers.update({"User-Agent": DEFAULT_USER_AGENT})
        self.fileDate = pm.dayLightSaving().strftime('%Y-%m-%dT%H%M%S')
        self.folderDate = pm.dayLightSaving().strftime('%Y-%m-%d')
        self.capturedDate = pm.dayLightSaving().strftime('%Y-%m-%dT%H:%M:%SZ')  
        self.gasHour = (pm.dayLightSaving()+datetime.timedelta(hours=configData['hoursAddSub'])).hour
        self.CachePath = re.sub('<DATE>',self.folderDate,configData['gasflow']['cachePath'])
        self.OutputPath = re.sub('<DATE>',self.folderDate,configData['gasflow']['outputPath'])
        pm.makeDirectory([self.CachePath, self.OutputPath])
        try:
            self.sess.get(
                'https://tron-gud.publication.virtimo.cloud/?language=en',
                timeout=30,
                verify=False,
            )
        except Exception:
            pass
        
        _types=["gasflow","nomination","renomination","production"]
        for _type in _types:
            Cache_Path = re.sub('<DATE>',self.folderDate,configData[_type]['cachePath'])
            Output_Path = re.sub('<DATE>',self.folderDate,configData[_type]['outputPath'])
            pm.makeDirectory([Cache_Path,Output_Path])
        self.values_hash = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(float))))
        self.mail_data = [configData['mailTrigger'], configData['emailUser'], configData['emailPassword'], configData['senderEmail'], configData['receiverEmails']]
        
    def get_dates(self,_type):
        self.dateList=[] 
        if configData[_type]['dayCalc']:
            for date in range(configData[_type]['startDay'],configData[_type]['endDay']+1):
                periodFrom = (datetime.datetime.strptime((pm.dayLightSaving()+datetime.timedelta(days=date)+datetime.timedelta(hours=configData['hoursAddSub'])).strftime('%Y-%m-%d 00:00:00.000'),'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(hours=abs(configData['hoursAddSub']))).strftime('%Y-%m-%d %H:%M:%S.000')
                self.dateList.append(periodFrom)
                
        elif configData[_type]['dateCalc']:
            startDate = datetime.datetime.strptime(configData[_type]['startDate'], "%Y-%m-%d")
            endDate = datetime.datetime.strptime(configData[_type]['endDate'], "%Y-%m-%d")
            while startDate <= endDate:
                self.dateList.append((startDate+datetime.timedelta(hours=abs(configData['hoursAddSub']))).strftime("%Y-%m-%d %H:%M:%S.000"))
                startDate += datetime.timedelta(days=1)
                
        elif configData[_type]['dateListCalc']:
            for date in configData[_type]['dateList']:
                date = datetime.datetime.strptime(date, "%Y-%m-%d")
                self.dateList.append((date+datetime.timedelta(hours=abs(configData['hoursAddSub']))).strftime("%Y-%m-%d %H:%M:%S.000"))
                
        return self.dateList        
                
    def missingPush(self):
        GasHour = self.gasHour+1
        GMT = self.capturedDate
        types=["gasflow","nomination","renomination"]
        for _typee in types:
            for date in self.get_dates(_typee):
                to_period = (datetime.datetime.strptime(date,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S.000')
                day = self.difference_in_days(date)
                for operator_name in configData[_typee]['operator_points']:
                    for pubip in configData[_typee]['operator_points'][operator_name]:
                        if(day<0 and _typee=="gasflow"):
                            pm.file_write(Rawdata_TSO, "a",f"{operator_name}|{pubip}|{date}|{to_period}|gas-day|{GasHour}|gas-flow|{GMT}||Missing|||||||||||||||||||||||||New\n")
                        if(_typee=="nomination"):
                            pm.file_write(Rawdata_NOM, "a",f"{operator_name}|{pubip}|{date}|{to_period}|gas-day|{GasHour}|nomination|{GMT}||Missing|||||||||||||||||||||||||New\n")
                        if(_typee=="renomination"):
                            pm.file_write(Rawdata_RENOM, "a",f"{operator_name}|{pubip}|{date}|{to_period}|gas-day|{GasHour}|re-nomination|{GMT}||Missing|||||||||||||||||||||||||New\n")    
                            
    def difference_in_days(self, g_date):
        current_date = (datetime.datetime.strptime((pm.dayLightSaving()+datetime.timedelta(hours=configData['hoursAddSub'])).strftime('%Y-%m-%d 00:00:00.000'),'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(hours=abs(configData['hoursAddSub']))).date()
        given_date = datetime.datetime.strptime(g_date, '%Y-%m-%d %H:%M:%S.%f').date()
        difference_days = (given_date - current_date).days
        return difference_days
        
  
    def readingBlock(self,_type): 
        Values = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
        datelist = self.get_dates(_type) 
        self.Values = dict()
        if configData['gasflow']['cacheMove']:
            self.gas_Cache_Path = re.sub('<DATE>',self.folderDate,configData[_type]['cachePath'])
        else:
            self.gas_Cache_Path=''
        if configData[_type]['dayCalc']:       
            search_from = (datetime.datetime.strptime((pm.dayLightSaving()+datetime.timedelta(days=configData[_type]['startDay']-1)+datetime.timedelta(hours=configData['hoursAddSub'])).strftime('%Y-%m-%d 00:00:00.000'),'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(hours=abs(configData['hoursAddSub']))).strftime('%Y-%m-%d')
            search_to =  (datetime.datetime.strptime((pm.dayLightSaving()+datetime.timedelta(days=configData[_type]['endDay']+1)+datetime.timedelta(hours=configData['hoursAddSub'])).strftime('%Y-%m-%d 00:00:00.000'),'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(hours=abs(configData['hoursAddSub']))).strftime('%Y-%m-%d')
            
        elif configData[_type]['dateCalc']:  
            search_from = (pm.datetime_operation(f"{configData[_type]['startDate']} 00:00:00", 'add','days',0)).strftime("%Y-%m-%d")
            search_to = (pm.datetime_operation(f"{configData[_type]['endDate']} 00:00:00", 'add','days',1)).strftime("%Y-%m-%d")
            
        elif configData[_type]['dateListCalc']:
            date_list=configData[_type]['dateList']
            dates = [datetime.datetime.strptime(date, "%Y-%m-%d") for date in date_list]
            search_from = (pm.datetime_operation(f"{min(dates).strftime('%Y-%m-%d')} 00:00:00", 'add','days',0)).strftime("%Y-%m-%d")
            search_to = (pm.datetime_operation(f"{max(dates).strftime('%Y-%m-%d')} 00:00:00", 'add','days',1)).strftime("%Y-%m-%d")
        
        if configData['gasflow']['cacheMove']:
            self.CachePath=configData['gasflow']['cachePath']
        else:
            self.CachePath=''
            
            
        

        ################################################
        # --- Main Logic Starts Here ---

        referer = 'https://tron-gud.publication.virtimo.cloud/?language=en'
        epoch_time = get_epoch_time()

        url_1 = f"https://tron-gud.publication.virtimo.cloud/ibis/servlet/IBISHTTPUploadServlet/PFW_Webapp_Funktionen?_dc={epoch_time}"

        headers = {
            "Host": "tron-gud.publication.virtimo.cloud",
            "Referer": referer,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        }
        
        post_data_1 = 'language=en&mandant=GUD&operation=pointsTree&node=root'
        print(f'url_1{url_1},post_data_1:{post_data_1}_headers{headers}')
        page_1_content = get_content(url_1, method='POST', data=post_data_1, headers=headers, session=self.sess)

        ip_mapping = {
            '1': ['Lubmin II', 'Lubmin II', '11.26', 'Lubmin II', ''],
            '2': ['Deutschneudorf EUGAL Brandov', 'Deutschneudorf EUGAL Brandov', '11.26', 'Deutschneudorf EUGAL Brandov', '']
        }

        gcv_values={}
        for key, ip_vals in ip_mapping.items():
            sheet_ip, pub_ip, gcv_ip, with_ip = ip_vals[:4]

            pattern = re.compile(
                rf'"treeName"\s*:\s*"{re.escape(sheet_ip)}"\s*,\s*"pointID"\s*:\s*"([\da-z]+)"\s*,\s*"flowType"\s*:\s*"([^"]*?)"',
                re.IGNORECASE
            )

            for match in pattern.finditer(page_1_content):
                point_id, flow_type = match.groups()
                post_data_2 = (
                    f"language=en&mandant=GASCADE&data="
                    f"%3Cdata%3E%3Cfrom%3E{search_from}%3C%2Ffrom%3E%3Cto%3E{search_to}%3C%2Fto%3E"
                    f"%3Cgranularity%3EStunden%3C%2Fgranularity%3E%3Ccollapsed%3Efalse%3C%2Fcollapsed%3E"
                    f"%3CtimeSeries%3E"
                    f"%3Citem%3E%3CpointID%3E{point_id}%3C%2FpointID%3E%3CflowType%3E{flow_type}%3C%2FflowType%3E"
                    f"%3CtimeSeriesCode%3ENomination%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E"
                    f"%3Citem%3E%3CpointID%3E{point_id}%3C%2FpointID%3E%3CflowType%3E{flow_type}%3C%2FflowType%3E"
                    f"%3CtimeSeriesCode%3ERenomination%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E"
                    f"%3Citem%3E%3CpointID%3E{point_id}%3C%2FpointID%3E%3CflowType%3E{flow_type}%3C%2FflowType%3E"
                    f"%3CtimeSeriesCode%3EPhysicalFlow%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E"
                    f"%3Citem%3E%3CpointID%3E{point_id}%3C%2FpointID%3E%3CflowType%3E{flow_type}%3C%2FflowType%3E"
                    f"%3CtimeSeriesCode%3EGCVPreliminary%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E"
                    f"%3C%2FtimeSeries%3E%3C%2Fdata%3E&operation=timeSeries&page=1&start=0&limit=25"
                )
                epoch_time = get_epoch_time()
                url_2 = f"https://tron-gud.publication.virtimo.cloud/ibis/servlet/IBISHTTPUploadServlet/PFW_Webapp_Funktionen?_dc={epoch_time}"
                post_data_2="""language=en&mandant=GUD&operation=timeSeriesExport&format=xlsx&data=%3Cdata%3E%3Cfrom%3E2025-07-14%3C%2Ffrom%3E%3Cto%3E2025-07-17%3C%2Fto%3E%3Cgranularity%3EGastage%3C%2Fgranularity%3E%3Ccollapsed%3Efalse%3C%2Fcollapsed%3E%3CtimeSeries%3E%3Citem%3E%3CpointID%3E1747%3C%2FpointID%3E%3CflowType%3EEntry%3C%2FflowType%3E%3CtimeSeriesCode%3ENomination%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E%3Citem%3E%3CpointID%3E1747%3C%2FpointID%3E%3CflowType%3EEntry%3C%2FflowType%3E%3CtimeSeriesCode%3ERenomination%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E%3Citem%3E%3CpointID%3E1747%3C%2FpointID%3E%3CflowType%3EEntry%3C%2FflowType%3E%3CtimeSeriesCode%3EFlow%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E%3Citem%3E%3CpointID%3E1747%3C%2FpointID%3E%3CflowType%3EEntry%3C%2FflowType%3E%3CtimeSeriesCode%3EFlowFinal%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E%3Citem%3E%3CpointID%3E1747%3C%2FpointID%3E%3CflowType%3EEntry%3C%2FflowType%3E%3CtimeSeriesCode%3EPrePhysicalFlow%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E%3Citem%3E%3CpointID%3E1747%3C%2FpointID%3E%3CflowType%3EEntry%3C%2FflowType%3E%3CtimeSeriesCode%3EPhysicalFlow%3C%2FtimeSeriesCode%3E%3C%2Fitem%3E%3C%2FtimeSeries%3E%3C%2Fdata%3E"""

                page_2_content = get_content(url_2, method='POST', data=post_data_2, headers=headers, session=self.sess)
                # # Extract JSON-like content using regex
                value_pattern = re.compile(
                    r'\{"from"\s*:\s*"([^"]+)",\s*"to"\s*:\s*"([^"]+)",\s*"values"\s*:\s*\["([^"]*)","([^"]*)","([^"]*)","([^"]*)"\]\}',
                    re.IGNORECASE
                )

                for match in value_pattern.finditer(page_2_content):
                    from_time, to_time, val1, val2, val3, gcv = match.groups()
                    gcv_values.setdefault(sheet_ip, {}).setdefault(from_time, {}).setdefault(flow_type, {})['gcv'] = gcv
                for gas_day_str in self.dateList:
                    gas_day_str=gas_day_str[:10]
                    gas_day = datetime.datetime.strptime(gas_day_str, "%Y-%m-%d")

                    GasDay = gas_day.replace(hour=0, minute=0, second=0, microsecond=0)

                    GasFlowAggregatedFrom = ""
                    GasFlowAggregatedTo = ""

                    for row in range(0,24):
                        r = row + 1
                        PeriodFrom_1 = GasDay + datetime.timedelta(hours=row+5)
                        
                        PeriodTo = GasDay + datetime.timedelta(hours=row+6)

                        match_from = PeriodTo.strftime("%m/%d/%Y %H:00")

                        entry_gcv = gcv_values.get(sheet_ip, {}).get(match_from, {}).get("Entry", {}).get("gcv", "")
                        exit_gcv = gcv_values.get(sheet_ip, {}).get(match_from, {}).get("Exit", {}).get("gcv", "")

                        # Fallback logic
                        for gcv in ["entry_gcv", "exit_gcv"]:
                            val = locals()[gcv]
                            if val == '' or float(val) == 0.0 or float(val) < 9 or float(val) > 12:
                                locals()[gcv] = gcv_ip
                        with open("GCV_TEMPLATE.txt", "a") as fh:

                            fh.write(f"{pub_ip}|{PeriodFrom_1.strftime('%Y-%m-%d %H:%M:%S')}.000|{PeriodTo.strftime('%Y-%m-%d %H:%M:%S')}.000|{entry_gcv}|{exit_gcv}|\n")
                    
                        
        for key, value in ip_mapping.items():
            sheetIP, pubIP, gcv_IP, with_IP = value[:4]

            pattern = rf'"treeName":"{re.escape(sheetIP)}",\s*"pointID":"([\da-z]+)",\s*"flowType":"([^"]*?)"'
            matches = re.finditer(pattern, page_1_content, re.IGNORECASE)

            for match in matches:
                pointID = match.group(1)
                flowType = match.group(2)

                xml_payload = f"""
                <data>
                    <from>{search_from}</from>
                    <to>{search_to}</to>
                    <granularity>Gastage</granularity>
                    <collapsed>false</collapsed>
                    <timeSeries>
                        <item><pointID>{pointID}</pointID><flowType>{flowType}</flowType><timeSeriesCode>Nomination</timeSeriesCode></item>
                        <item><pointID>{pointID}</pointID><flowType>{flowType}</flowType><timeSeriesCode>Renomination</timeSeriesCode></item>
                        <item><pointID>{pointID}</pointID><flowType>{flowType}</flowType><timeSeriesCode>PhysicalFlow</timeSeriesCode></item>
                        <item><pointID>{pointID}</pointID><flowType>{flowType}</flowType><timeSeriesCode>GCVPreliminary</timeSeriesCode></item>
                    </timeSeries>
                </data>
                """.strip()

                post_data = {
                    "language": "en",
                    "mandant": "GASCADE",
                    "data": quote(xml_payload),
                    "operation": "timeSeries",
                    "page": "1",
                    "start": "0",
                    "limit": "25"
                }

                epoch_time = str(int(time.time() * 1000))
                link_url = f"https://tron-gud.publication.virtimo.cloud/ibis/servlet/IBISHTTPUploadServlet/PFW_Webapp_Funktionen?_dc={epoch_time}"

                try:
                    response = requests.post(link_url, data=post_data, headers=headers)
                    content = unidecode(response.text)
                    
                    pattern_data = re.finditer(r'{"from":"([^"]*?)","to":"([^"]*?)","values":\["([^"]*?)","([^"]*?)","([^"]*?)","([^"]*?)"\]}', content)
                    for item in pattern_data:
                        from_date = item.group(1)
                        
                        gcv_value = item.group(6)
                        Values.setdefault(sheetIP, {}).setdefault(from_date, {}).setdefault(flowType, {})['gcv'] = gcv_value
                        print(Values)

                except Exception as e:
                    print(f"Error fetching data for {sheetIP}: {e}")
            
            with open("GCV_TEMPLATE.txt", "a") as fh:
                for date in self.dateList:
                    dt_base = datetime.datetime.strptime(date,'%Y-%m-%d %H:%M:%S.%f')
                    Periodfrom = (dt_base).strftime('%Y-%m-%d')
                    Periodto = (dt_base + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
                    to_period = (datetime.datetime.strptime(date,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S.000')

                    Searchdate = f"{Periodfrom} 06:00:00.000"
                    from_period = f"{Periodfrom} 05:00:00.000"
                    to_period = f"{Periodto} 05:00:00.000"

                    match_from = datetime.datetime.strptime(Searchdate, "%Y-%m-%d %H:%M:%S.%f").strftime('%m/%d/%Y %H:00')
                    entry_gcv = gcv_values.get(sheetIP, {}).get(match_from, {}).get("Entry", {}).get("gcv", "")
                    exit_gcv = gcv_values.get(sheetIP, {}).get(match_from, {}).get("Exit", {}).get("gcv", "")

                    def validate_gcv(gcv):
                        try:
                            gcv_f = float(gcv)
                            return gcv_f if 9 <= gcv_f <= 12 else gcv_IP
                        except:
                            return gcv_IP

                    entry_gcv = validate_gcv(entry_gcv)
                    exit_gcv = validate_gcv(exit_gcv)

                    fh.write(f"{pubIP}|{from_period}|{to_period}|{entry_gcv}|{exit_gcv}|\n")

        # ##################################################################





        ###############Main data###########
        Values={}
        Referer		= 'https://tron-gud.publication.virtimo.cloud/?language=en'
        Link_URL	= f"https://tron-gud.publication.virtimo.cloud/ibis/servlet/IBISHTTPUploadServlet/PFW_Webapp_Funktionen?_dc={epoch_time}"
        post='language=en&mandant=GUD&operation=pointsTree&node=root'
        headers = {
            "Host": "tron-gud.publication.virtimo.cloud",
            "Referer": Referer,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        }
        page_1_content=get_content(Link_URL,'POST',post,headers, session=self.sess)
        ip_mapping={
        '15':['VIP TTF-THE-H', 'VIP-TTF-THE-H', '11.27', 'VIP-TTF-THE-H', ''],
        '17' :['Brunsbuettel Hafen (FSRU)', 'Brunsbuettel Hafen (FSRU)', '11.53', 'Brunsbuettel Hafen (FSRU)', ''],
        '3' :['Dornum', 'Dornum', '11.356', 'Dornum', ''],
        '4' : ['VIP DK-THE', 'Ellund', '11.23', 'Ellund', ''],
        '6' :['Emden-EPT1', 'Emden EPT1', '11.45', 'Emden-EPT1', ''],
        '7' : ['Emden-EPT1\s*\(H071\)', 'Emden EPT1', '11.45', 'Emden-EPT1 (H071)', ''],
        '8' : ['Deutschneudorf Eugal Brandov ', 'Deutschneudorf Eugal Brandov', '11.26', 'Deutschneudorf Eugal Brandov', ''],
        '9' : ['Lubmin II', 'Lubmin II', '11.26', 'Lubmin II', ''],
        '10': ['H-Gas-Summe Produktion PHSUM', 'Domestic ProductionH', '11.3', 'ProductionH', ''],
        '11': ['L-Gas-Summe Produktion PLSUM', 'Domestic ProductionL', '11.3', 'ProductionL', ''],
        '12' :['H-Gas-Summe Letztverbraucher LHSUM', 'Gasunie DeutschlandH', '11.3', 'DeutschlandH', ''],
        '13' :['L-Gas-Summe Letztverbraucher LLSUM', 'Gasunie DeutschlandL', '11.3', 'DeutschlandL', ''],
        '2' :['Oude Statenzijl L', 'Oude Statenzijl L', '9.735', 'Oude Statenzijl L', ''],
        '5' :['Greifswald / Vierow', 'Greifswald', '11.26', 'Greifswald', ''],
        '16' :['VIP DK-THE', 'VIP DK-THE', '11.26', 'VIP DK-THE', '']
        }
        for key, ip_vals in ip_mapping.items():
            sheet_ip, pub_ip, gcv_ip, with_ip = ip_vals[:4]
            pattern = re.compile(
            rf'"treeName"\s*:\s*"{re.escape(sheet_ip)}"\s*,\s*"pointID"\s*:\s*"([^"]+)"\s*,\s*"flowType"\s*:\s*"([^"]+)"',
            re.IGNORECASE
        )
            
            for match in pattern.finditer(page_1_content):
                
                point_id, flow_type = match.groups()
                print('point_id',point_id,'flow_type',flow_type)
                

                # Build the post_pg2 data
                items = ['Nomination', 'Renomination', 'PrePhysicalFlow', 'PhysicalFlow', 'GCVPreliminary', 'GCVFinal']
                # items=['Final PhysicalFlow']
                timeseries_items = ''.join([
                    f"<item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>{code}</timeSeriesCode></item>"
                    for code in items
                ])
                
                data_xml = (
                    f"<data><from>{search_from}</from><to>{search_to}</to><granularity>Stunden</granularity>"
                    f"<collapsed>false</collapsed><timeSeries>{timeseries_items}</timeSeries></data>"
                )
                encoded_data = requests.utils.quote(data_xml)

                post_pg2 = (
                    f"language=en&mandant=GUD&data={encoded_data}"
                    "&operation=timeSeries&page=1&start=0&limit=25"
                )

                # Get current epoch time in milliseconds (13 digits)
                epoch_time = str(int(time.time() * 1000))

                link_url = f"https://tron-gud.publication.virtimo.cloud/ibis/servlet/IBISHTTPUploadServlet/PFW_Webapp_Funktionen?_dc={epoch_time}"
                xml_data = f"""<data>
                    <from>{search_from}</from>
                    <to>{search_to}</to>
                    <granularity>Stunden</granularity>
                    <collapsed>false</collapsed>
                    <timeSeries>
                    <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>Nomination</timeSeriesCode></item>
                    <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>Renomination</timeSeriesCode></item>
                    <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>PrePhysicalFlow</timeSeriesCode></item>
                    <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>PhysicalFlow</timeSeriesCode></item>
                    <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>GCVPreliminary</timeSeriesCode></item>
                    <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>GCVFinal</timeSeriesCode></item>
                    </timeSeries>
                    </data>"""

                    # URL encode the XML
                encoded_data = quote(xml_data)

                # Build the final POST body string
                post_pg2 = (
                    f"language=en&mandant=GUD&data={encoded_data}"
                    f"&operation=timeSeries&page=1&start=0&limit=25"
                )

                # Send the POST request
                response = requests.post(link_url, data=post_pg2, headers=headers)
                page_2_content = unidecode(response.text)
                cache_file = f"{self.gas_Cache_Path}TSO13_Gasunie_Deutschland_hourly_{with_ip}_{flow_type}{self.fileDate}.html"

                print(f"Saving to file: {cache_file}")
                with open(cache_file, 'w', encoding='utf-8') as f:
                    f.write(page_2_content)
                parsed = json.loads(page_2_content)
                for entry in parsed.get("data", []):
                    from_time = entry.get("from")
                    values = entry.get("values", [])
                    if len(values) >= 6:
                        nom = values[0]
                        renom = values[1]
                        flow = values[2]
                        gcv = values[4]
                        # Handle scientific notation conversion if present
                        def convert(val):
                            try:
                                return float(val)
                            except ValueError:
                                return val

                        nom = convert(nom)
                        renom = convert(renom)
                        flow = convert(flow)
                        gcv = convert(gcv)

                        Values.setdefault('hour', {}).setdefault(sheet_ip, {}).setdefault(from_time, {}).setdefault(flow_type, {})
                        Values['hour'][sheet_ip][from_time][flow_type]['nom'] = nom
                        Values['hour'][sheet_ip][from_time][flow_type]['renom'] = renom
                        Values['hour'][sheet_ip][from_time][flow_type]['flow'] = flow
                        Values['hour'][sheet_ip][from_time][flow_type]['gcv'] = gcv
                        
                        
            #########################   GAS Day part#############
            for match in pattern.finditer(page_1_content):
                point_id, flow_type = match.groups()
                data = f"""<data>
                <from>{search_from}</from>
                <to>{search_to}</to>
                <granularity>Gastage</granularity>
                <collapsed>false</collapsed>
                <timeSeries>
                <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>Nomination</timeSeriesCode></item>
                <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>Renomination</timeSeriesCode></item>
                <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>PrePhysicalFlow</timeSeriesCode></item>
                <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>PhysicalFlow</timeSeriesCode></item>
                <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>GCVPreliminary</timeSeriesCode></item>
                <item><pointID>{point_id}</pointID><flowType>{flow_type}</flowType><timeSeriesCode>GCVFinal</timeSeriesCode></item>
                </timeSeries>
                </data>"""

                post_pg2_gasday = {
                    "language": "en",
                    "mandant": "GUD",
                    "data": data,
                    "operation": "timeSeries",
                    "page": 1,
                    "start": 0,
                    "limit": 25
                }
                link_url = f"https://tron-gud.publication.virtimo.cloud/ibis/servlet/IBISHTTPUploadServlet/PFW_Webapp_Funktionen?_dc={epoch_time}"

                # Send the POST request
                response = requests.post(link_url, data=post_pg2_gasday, headers=headers)
                gasdaypage_2_content = unidecode(response.text)
                cache_file = f"{self.gas_Cache_Path}TSO13_Gasunie_Deutschland_daily_{with_ip}_{flow_type}{self.fileDate}.html"

                # Save or print
                print(f"Saving to file: {cache_file}")
                with open(cache_file, 'w', encoding='utf-8') as f:
                    f.write(gasdaypage_2_content)
                parsed = json.loads(gasdaypage_2_content)

                for entry in parsed.get("data", []):
                    from_time = (entry.get("from") or "")[:10]
                    values = entry.get("values", [])
                    
                    if len(values) >= 6:
                        nom = values[0]
                        renom = values[1]
                        flow = values[2]
                        gcv = values[4]

                        # Handle scientific notation conversion if present
                        def convert(val):
                            try:
                                return float(val)
                            except ValueError:
                                return val

                        nom = convert(nom)
                        renom = convert(renom)
                        flow = convert(flow)
                        gcv = convert(gcv)

                        # Build nested dict as in Perl
                        Values.setdefault('day', {}).setdefault(sheet_ip, {}).setdefault(from_time, {}).setdefault(flow_type, {})
                        Values['day'][sheet_ip][from_time][flow_type]['nom'] = nom
                        Values['day'][sheet_ip][from_time][flow_type]['renom'] = renom
                        Values['day'][sheet_ip][from_time][flow_type]['flow'] = flow
                        Values['day'][sheet_ip][from_time][flow_type]['gcv'] = gcv

        self.Values=Values
            
    def writingBlock_Gasflow(self,_type):
        GMT = self.capturedDate
        r_g = self.gasHour+1
        dateList = self.get_dates(_type) 
        Values = self.Values
        for date in dateList:
            from_period = date
            to_period = (datetime.datetime.strptime(date,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S.000')
            chk_date = date[:10]
            print(f"_type {_type} from_period {from_period} to_period {to_period}\n")
            day = self.difference_in_days(from_period)
            GasHour=23 if(day!=0) else self.gasHour 
            GasDay=chk_date+' 00:00:00'
            GasDay_dt = datetime.datetime.strptime(GasDay, "%Y-%m-%d %H:%M:%S")
            GasFlowAggregatedFrom = ""
            GasFlowAggregatedTo = ""
            for operator_name in configData[_type]['operator_points']:
                for pubIP in configData[_type]['operator_points'][operator_name]:
                    pubip= pubIP
                    sheetIP = configData[_type]['op_details'][pubIP][0]
                    
                    if configData['gasflow']['gas-day']:
                        
                        try:
                            if day<=-1:
                        
                                state_gf='Provisional'
                            
                                base_time = datetime.datetime.strptime(date[:10], "%Y-%m-%d").strftime("%m/%d/%Y")
                                entry_gf = Values['day'].get(sheetIP, {}).get(base_time, {}).get("Entry", {}).get("flow",'')
                                exit_gf= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Exit", {}).get("flow",'')
                                gcv_entry= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Entry", {}).get("gcv", '')
                                gcv_exit= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Exit", {}).get("gcv", '')
                                
                                if not gcv_exit:
                                    gcv_exit= configData['gasflow']['gcv'][pubip]['value']
                                if not gcv_entry:
                                    gcv_entry=configData['gasflow']['gcv'][pubip]['value']
                            
                                if (entry_gf==None or entry_gf=='') and (exit_gf==None or exit_gf==''):
                                    state_gf='Missing'
                                
                                # print(f"Hour: , PeriodFrom: {from_period}, PeriodTo: {to_period}")
                                # print(f"state_gf: {state_gf}, Entry: {entry_gf}, Exit: {exit_gf}")
                                # print("---")
                                
                                if(chk_date in configData[_type]['skipData'][pubIP] or chk_date in configData[_type]['skipData']["All"]):
                                    continue
                                elif(chk_date in configData[_type]['missingData'][pubIP] or chk_date in configData[_type]['missingData']["All"]  or state_gf=='Missing'  or((gcv_entry == '') and (gcv_exit == ''))):
                                    data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|gas-flow|{GMT}||Missing|||||||||||||||||||||||||New\n"
                                elif (chk_date in configData[_type]['emptyProvisionalData'][pubIP] or chk_date in configData[_type]['emptyProvisionalData']["All"]) or (chk_date == (datetime.datetime.today() - datetime.timedelta(days=1)).strftime('%Y-%m-%d') and pubip=='VIP-TTF-THE-H'):
                                    data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|gas-flow|{GMT}||Provisional|||||||||||||||||||||||||New\n"
                                else:
                                    data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|gas-flow|{GMT}||Provisional|{entry_gf}|kwh|||||{gcv_entry}|kWh/Nm3|{exit_gf}|kwh|||||{gcv_exit}|kWh/Nm3|||||||||New\n"
                                    
                                
                                pm.file_write(Rawdata_TSO, "a",data)
                        except:
                            data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|gas-flow|{GMT}||Missing|||||||||||||||||||||||||New\n"
                            pm.file_write(Rawdata_TSO, "a",data)
                        
                    
                    if configData['gasflow']['intra-day']:
                        for row in range(0, GasHour + 1):  # or use range(0, 24)
                            # try:
                                gas_hour=row+1
                                state_gf = State_nom = State_renom = 'Provisional'
                                gasday_label = GasDay_dt + datetime.timedelta(hours=row + 6)
                                gashour = gasday_label.strftime("%H")
                                # Get PeriodFrom and PeriodTo
                                gasday_time = GasDay_dt + datetime.timedelta(hours=row + 5)
                                PeriodFrom_1 = gasday_time.strftime("%Y-%m-%d %H:00:00.000")
                                PeriodTo_dt = gasday_time + datetime.timedelta(hours=1)
                                PeriodTo = PeriodTo_dt.strftime("%Y-%m-%d %H:00:00.000")
                                if day != 0 and GasFlowAggregatedFrom == "":
                                    GasFlowAggregatedFrom = PeriodFrom_1
                                    GasFlowAggregatedTo = (GasDay_dt + datetime.timedelta(days=1)).strftime("%Y-%m-%d 00:00:00.000")
                                # Convert to mm/dd/yyyy HH:00 for lookup
                                
                                
                                match_from = PeriodTo_dt.strftime("%m/%d/%Y %H:00")
                                entry_gf_hr = Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Entry", {}).get("flow",'')
                                exit_gf_hr = Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Exit", {}).get("flow",'')
                                gcv_entry= Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Entry", {}).get("gcv", '')
                                gcv_exit= Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Exit", {}).get("gcv", '')
                                
                                
                                
                                
                                ############   Replicated  logic##########
                                if configData['gasflow']['replicatedate']:
                                    ## replicate date Automated here ##
                                    # replicate_startdate=configData['gasflow']['replicatedate']
                                    replicate_startdate = (datetime.datetime.today() - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
                                    
                                    replicate_num_days=configData['gasflow']['replicatenumofdays']
                                    dt = datetime.datetime.strptime(replicate_startdate, "%Y-%m-%d")

                                    # Set base date dynamically from dt (you can replace this with any logic)
                                    base_date = dt.date()  # example: 2025-07-17

                                    # Define start and end times for the window
                                    start_time = datetime.datetime.combine(base_date, datetime.time(5, 0))  # 05:00 of base_date
                                    replcate_match_from = datetime.datetime.combine(base_date, datetime.time(5, 0)).strftime("%m/%d/%Y %H:00")
                                    
                                    end_time = datetime.datetime.combine(base_date + datetime.timedelta(days=replicate_num_days), datetime.time(23, 0))
                                   
                                    PeriodFrom_dt = datetime.datetime.strptime(PeriodFrom_1, '%Y-%m-%d %H:%M:%S.%f') 
                                    if pubIP == 'VIP-TTF-THE-H' and start_time <= PeriodFrom_dt < end_time:
                                        entry_gf_hr = Values['hour'].get(sheetIP, {}).get(replcate_match_from, {}).get("Entry", {}).get("flow",'')
                                        
                                        exit_gf_hr = Values['hour'].get(sheetIP, {}).get(replcate_match_from, {}).get("Exit", {}).get("flow",'')
                                        
                                        gcv_entry= Values['hour'].get(sheetIP, {}).get(replcate_match_from, {}).get("Entry", {}).get("gcv", '')
                                        gcv_exit= Values['hour'].get(sheetIP, {}).get(replcate_match_from,{}).get("Exit", {}).get("gcv", '')
                                        state_gf = 'Provisional'
                                        
                                start_skip = datetime.datetime.strptime("2025-11-25 05:00:00.000", "%Y-%m-%d %H:%M:%S.%f")
                                end_skip = datetime.datetime.strptime("2025-11-26 04:00:00.000", "%Y-%m-%d %H:%M:%S.%f")
                                current_dt = datetime.datetime.strptime(PeriodFrom_1, "%Y-%m-%d %H:%M:%S.%f")

                                if start_skip <= current_dt <= end_skip:
                                    print("Skip this record")
                                    continue
                                else:
                                    print("Process this record")
                                     
                                ####################################
                                
                                if not gcv_exit:
                                    gcv_exit= configData['gasflow']['gcv'][pubip]['value']
                                if not gcv_entry:
                                    gcv_entry=configData['gasflow']['gcv'][pubip]['value']
                                # print(f"Hour: {gashour}, PeriodFrom: {PeriodFrom_1}, PeriodTo: {PeriodTo}")
                                # print(f"Match From Key: {match_from}, Entry: {entry_gf_hr}, Exit: {exit_gf_hr}")
                                if (entry_gf_hr==None or entry_gf_hr=='') and (exit_gf_hr==None or exit_gf_hr==''):
                                    state_gf='Missing'
                                
                                if(chk_date in configData[_type]['skipData_intra'][pubIP] or chk_date in configData[_type]['skipData_intra']["All"]):continue
                                elif( state_gf=='Missing' ):
                                    data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|gas-flow|{GMT}||Missing|||||||||||||||||||||||||New\n"
                                # elif (chk_date in configData[_type]['emptyProvisionalData'][pubIP] or chk_date in configData[_type]['emptyProvisionalData']["All"]):
                                #     data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|gas-flow|{GMT}||state_gf|||||||||||||||||||||||||New\n"
                                else:
                                    data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|gas-flow|{GMT}||Provisional|{entry_gf_hr}|kwh|||||{gcv_entry}|kWh/Nm3|{exit_gf_hr}|kwh|||||{gcv_exit}|kWh/Nm3|||||||||New\n"
                                pm.file_write(Rawdata_TSO, "a",data)
                            # except:
                                # data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|gas-flow|{GMT}||Missing|||||||||||||||||||||||||New\n"
                                # pm.file_write(Rawdata_TSO, "a",data)
            
                        
    def writingBlock_Nomination(self,_type):
        GMT = self.capturedDate
        r_g = self.gasHour+1
        dateList = self.get_dates(_type) 
        Values = self.Values
        for date in dateList:
            from_period = date
            to_period = (datetime.datetime.strptime(date,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S.000')
            
            chk_date = date[:10]
            GasDay=chk_date+' 00:00:00'
            GasDay_dt = datetime.datetime.strptime(GasDay, "%Y-%m-%d %H:%M:%S")
            day = self.difference_in_days(from_period)
            GasHour=23 if(day!=0) else self.gasHour 
            GasDay=chk_date+' 00:00:00'
            for operator_name in configData[_type]['operator_points']:
                for pubIP in configData[_type]['operator_points'][operator_name]:
                    pubip= pubIP
                    sheetIP = configData[_type]['op_details'][pubIP][0]
                    
                    if configData['nomination']['gas-day']:
                        state_nom='Provisional'
                        if pubIP=='Lubmin II GUD':
                            sheetIP='Lubmin II'
                    
                        
                        base_time = datetime.datetime.strptime(date[:10], "%Y-%m-%d").strftime("%m/%d/%Y")
                        entry_nom = Values['day'].get(sheetIP, {}).get(base_time, {}).get("Entry", {}).get("nom",'')
                        exit_nom= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Exit", {}).get("nom",'')
                        gcv_exit= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Entry", {}).get("gcv", '')
                        gcv_entry= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Exit", {}).get("gcv", '')
                        if re.search(r"Lubmin|EUGAL", pubIP, re.IGNORECASE):
                            with open("GCV_TEMPLATE.txt", "r") as f:
                                GCV_verify = f.read()
                            
                            # Build regex pattern similar to Perl logic
                            pattern = re.compile(rf"{re.escape(pubIP)}[^\|]*?\|{re.escape(from_period)}\|{re.escape(to_period)}\|([^\|]*?)\|([^\|]*?)\|", re.IGNORECASE | re.DOTALL)

                            match = pattern.search(GCV_verify)
                            if match:
                                gcv_entry = match.group(1)
                                gcv_exit = match.group(2)
                        
                        if not gcv_exit:
                            gcv_exit= configData['nomination']['gcv'][pubip]['value']
                        if not gcv_entry:
                            gcv_entry=configData['nomination']['gcv'][pubip]['value']
                        
                        if (entry_nom==None or entry_nom=='') and (exit_nom==None or exit_nom==''):
                            state_nom='Missing'
                        
                        # if not entry_nom and not exit_nom:
                            # state_nom = 'Missing'
                        if(chk_date in configData[_type]['skipData'][pubIP] or chk_date in configData[_type]['skipData']["All"]):continue
                        elif(chk_date in configData[_type]['missingData'][pubIP] or chk_date in configData[_type]['missingData']["All"]  or state_nom=='Missing'  or((gcv_entry == '') and (gcv_exit == ''))):
                            data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|nomination|{GMT}||{state_nom}|||||||||||||||||||||||||New\n"
                        elif (chk_date in configData[_type]['emptyProvisionalData'][pubIP] or chk_date in configData[_type]['emptyProvisionalData']["All"]):
                            data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|nomination|{GMT}||state_nom|||||||||||||||||||||||||New\n"
                        else:
                            data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|nomination|{GMT}||Provisional|{entry_nom}|kwh|||||{gcv_entry}|kWh/Nm3|{exit_nom}|kwh|||||{gcv_exit}|kWh/Nm3|||||||||New\n"
                            
                        
                        pm.file_write(Rawdata_NOM, "a",data)
                    
                    
                    if configData['nomination']['intra-day']:
                        for row in range(0, GasHour + 1):  # or use range(0, 24)
                            if day<=0:
                                gas_hour=row+1
                                state_nom  = State_renom = 'Provisional'
                                gas_hour=row+1
                                    # if row < 5:
                                        # gas_hour = row + 20
                                    # else:
                                        # gas_hour = row - 4
                                state_gf = State_nom = State_renom = 'Provisional'
                                gasday_label = GasDay_dt + datetime.timedelta(hours=row + 6)
                                gashour = gasday_label.strftime("%H")
                                # Get PeriodFrom and PeriodTo
                                gasday_time = GasDay_dt + datetime.timedelta(hours=row + 5)
                                PeriodFrom_1 = gasday_time.strftime("%Y-%m-%d %H:00:00.000")
                                PeriodTo_dt = gasday_time + datetime.timedelta(hours=1)
                                PeriodTo = PeriodTo_dt.strftime("%Y-%m-%d %H:00:00.000")
                                if pubIP=='Lubmin II GUD':
                                    sheetIP='Lubmin II'
                                
                                match_from = PeriodTo_dt.strftime("%m/%d/%Y %H:00")
                                entry_nom_hr = Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Entry", {}).get("nom",'')
                                exit_nom_hr = Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Exit", {}).get("nom",'')
                                gcv_exit= Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Entry", {}).get("gcv", '')
                                gcv_entry= Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Exit", {}).get("gcv", '')
                                if re.search(r"Lubmin|EUGAL", pubIP, re.IGNORECASE):
                                    with open("GCV_TEMPLATE.txt", "r") as f:
                                        GCV_verify = f.read()
                                    
                                    # Build regex pattern similar to Perl logic
                                    pattern = re.compile(rf"{re.escape(pubIP)}[^\|]*?\|{re.escape(from_period)}\|{re.escape(to_period)}\|([^\|]*?)\|([^\|]*?)\|", re.IGNORECASE | re.DOTALL)

                                    match = pattern.search(GCV_verify)
                                    if match:
                                        gcv_entry = match.group(1)
                                        gcv_exit = match.group(2)
                                if not gcv_exit:
                                    gcv_exit= configData['nomination']['gcv'][pubip]['value']
                                if not gcv_entry:
                                    gcv_entry=configData['nomination']['gcv'][pubip]['value']
                                if (entry_nom_hr==None or entry_nom_hr=='') and (exit_nom_hr==None or exit_nom_hr==''):
                                    state_nom='Missing'
                                
                                if(chk_date in configData[_type]['skipData'][pubIP] or chk_date in configData[_type]['skipData']["All"]):continue
                                elif(chk_date in configData[_type]['missingData'][pubIP] or chk_date in configData[_type]['missingData']["All"]  or state_nom=='Missing' ):
                                    data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|nomination|{GMT}||{state_nom}|||||||||||||||||||||||||New\n"
                                elif (chk_date in configData[_type]['emptyProvisionalData'][pubIP] or chk_date in configData[_type]['emptyProvisionalData']["All"]):
                                    data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|nomination|{GMT}||state_nom|||||||||||||||||||||||||New\n"
                                else:
                                    data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|nomination|{GMT}||Provisional|{entry_nom_hr}|kwh|||||{gcv_entry}|kWh/Nm3|{exit_nom_hr}|kwh|||||{gcv_exit}|kWh/Nm3|||||||||New\n"
                                pm.file_write(Rawdata_NOM, "a",data)
                        
    def writingBlock_Renomination(self,_type):
        GMT = self.capturedDate
        r_g = self.gasHour+1
        dateList = self.get_dates(_type) 
        Values = self.Values
        for date in dateList:
            from_period = date
            to_period = (datetime.datetime.strptime(date,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S.000')
            
            chk_date = date[:10]
            GasDay=chk_date+' 00:00:00'
            GasDay_dt = datetime.datetime.strptime(GasDay, "%Y-%m-%d %H:%M:%S")
            print(f"_type {_type} from_period {from_period} to_period {to_period}\n")
            day = self.difference_in_days(from_period)
            GasHour=23 if(day!=0) else self.gasHour 
            GasDay=chk_date+' 00:00:00'
            for operator_name in configData[_type]['operator_points']:
                for pubIP in configData[_type]['operator_points'][operator_name]:
                    pubip= pubIP
                    sheetIP = configData[_type]['op_details'][pubIP][0]
                    
                    if configData['renomination']['gas-day']:
                        state_nom='Provisional'
                        if pubIP=='Lubmin II GUD':
                            sheetIP='Lubmin II'
                    
                        
                        base_time = datetime.datetime.strptime(date[:10], "%Y-%m-%d").strftime("%m/%d/%Y")
                        entry_nom = Values['day'].get(sheetIP, {}).get(base_time, {}).get("Entry", {}).get("renom",'')
                        exit_nom= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Exit", {}).get("renom",'')
                        gcv_exit= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Entry", {}).get("gcv", '')
                        gcv_entry= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Exit", {}).get("gcv", '')
                        if re.search(r"Lubmin|EUGAL", pubIP, re.IGNORECASE):
                            with open("GCV_TEMPLATE.txt", "r") as f:
                                GCV_verify = f.read()
                            
                            # Build regex pattern similar to Perl logic
                            pattern = re.compile(rf"{re.escape(pubIP)}[^\|]*?\|{re.escape(from_period)}\|{re.escape(to_period)}\|([^\|]*?)\|([^\|]*?)\|", re.IGNORECASE | re.DOTALL)

                            match = pattern.search(GCV_verify)
                            if match:
                                gcv_entry = match.group(1)
                                gcv_exit = match.group(2)
                        
                        if not gcv_exit:
                            gcv_exit= configData['renomination']['gcv'][pubip]['value']
                        if not gcv_entry:
                            gcv_entry=configData['renomination']['gcv'][pubip]['value']
                        
                        if (entry_nom==None or entry_nom=='') and (exit_nom==None or exit_nom==''):
                            state_nom='Missing'
                        
                        # if not entry_nom and not exit_nom:
                            # state_nom = 'Missing'
                        
                        if(chk_date in configData[_type]['skipData'][pubIP] or chk_date in configData[_type]['skipData']["All"]):continue
                        elif(chk_date in configData[_type]['missingData'][pubIP] or chk_date in configData[_type]['missingData']["All"]  or state_nom=='Missing'  or((gcv_entry == '') and (gcv_exit == ''))):
                            data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|re-nomination|{GMT}||{state_nom}|||||||||||||||||||||||||New\n"
                        elif (chk_date in configData[_type]['emptyProvisionalData'][pubIP] or chk_date in configData[_type]['emptyProvisionalData']["All"]):
                            data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|re-nomination|{GMT}||state_nom|||||||||||||||||||||||||New\n"
                        else:
                            data = f"{operator_name}|{pubip}|{from_period}|{to_period}|gas-day|{r_g}|re-nomination|{GMT}||Provisional|{entry_nom}|kwh|||||{gcv_entry}|kWh/Nm3|{exit_nom}|kwh|||||{gcv_exit}|kWh/Nm3|||||||||New\n"
                            
                        
                        pm.file_write(Rawdata_RENOM, "a",data)
                    
                    
                    if configData['renomination']['intra-day']:
                        for row in range(0, GasHour + 1):  # or use range(0, 24)
                            if day<=0:
                                gas_hour=row+1
                                state_nom  = State_renom = 'Provisional'
                                gas_hour=row+1
                                    # if row < 5:
                                        # gas_hour = row + 20
                                    # else:
                                        # gas_hour = row - 4
                                # print(f"hour = {row}, gas_hour = {gas_hour}")
                                state_gf = State_nom = State_renom = 'Provisional'
                                gasday_label = GasDay_dt + datetime.timedelta(hours=row + 6)
                                gashour = gasday_label.strftime("%H")
                                # Get PeriodFrom and PeriodTo
                                gasday_time = GasDay_dt + datetime.timedelta(hours=row + 5)
                                PeriodFrom_1 = gasday_time.strftime("%Y-%m-%d %H:00:00.000")
                                PeriodTo_dt = gasday_time + datetime.timedelta(hours=1)
                                PeriodTo = PeriodTo_dt.strftime("%Y-%m-%d %H:00:00.000")
                                if pubIP=='Lubmin II GUD':
                                    sheetIP='Lubmin II'
                            
                                
                                match_from = PeriodTo_dt.strftime("%m/%d/%Y %H:00")
                                entry_nom_hr = Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Entry", {}).get("renom",'')
                                exit_nom_hr = Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Exit", {}).get("renom",'')
                                gcv_exit= Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Entry", {}).get("gcv", '')
                                gcv_entry= Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Exit", {}).get("gcv", '')
                                if re.search(r"Lubmin|EUGAL", pubIP, re.IGNORECASE):
                                    with open("GCV_TEMPLATE.txt", "r") as f:
                                        GCV_verify = f.read()
                                    
                                    # Build regex pattern similar to Perl logic
                                    pattern = re.compile(rf"{re.escape(pubIP)}[^\|]*?\|{re.escape(from_period)}\|{re.escape(to_period)}\|([^\|]*?)\|([^\|]*?)\|", re.IGNORECASE | re.DOTALL)

                                    match = pattern.search(GCV_verify)
                                    if match:
                                        gcv_entry = match.group(1)
                                        gcv_exit = match.group(2)
                                if not gcv_exit:
                                    gcv_exit= configData['renomination']['gcv'][pubip]['value']
                                if not gcv_entry:
                                    gcv_entry=configData['renomination']['gcv'][pubip]['value']
                                if (entry_nom_hr==None or entry_nom_hr=='') and (exit_nom_hr==None or exit_nom_hr==''):
                                    state_nom='Missing'
                                
                                if(chk_date in configData[_type]['skipData'][pubIP] or chk_date in configData[_type]['skipData']["All"]):continue
                                elif(chk_date in configData[_type]['missingData'][pubIP] or chk_date in configData[_type]['missingData']["All"]  or state_nom=='Missing' ):
                                    data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|re-nomination|{GMT}||{state_nom}|||||||||||||||||||||||||New\n"
                                elif (chk_date in configData[_type]['emptyProvisionalData'][pubIP] or chk_date in configData[_type]['emptyProvisionalData']["All"]):
                                    data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|re-nomination|{GMT}||state_nom|||||||||||||||||||||||||New\n"
                                else:
                                    data = f"{operator_name}|{pubip}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|re-nomination|{GMT}||Provisional|{entry_nom_hr}|kwh|||||{gcv_entry}|kWh/Nm3|{exit_nom_hr}|kwh|||||{gcv_exit}|kWh/Nm3|||||||||New\n"
                                pm.file_write(Rawdata_RENOM, "a",data)


    def writingBlock_Production(self,_type):
        GMT = self.capturedDate
        r_g = self.gasHour+1
        dateList = self.get_dates(_type) 
        Values = self.Values
        for date in dateList:
            from_period = date
            to_period = (datetime.datetime.strptime(date,'%Y-%m-%d %H:%M:%S.%f')+datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S.000')
            chk_date = date[:10]
            print(f"_type {_type} from_period {from_period} to_period {to_period}\n")
            day = self.difference_in_days(from_period)
            GasHour=23 if(day!=0) else self.gasHour 
            GasDay=chk_date+' 00:00:00'
            GasDay_dt = datetime.datetime.strptime(GasDay, "%Y-%m-%d %H:%M:%S")
            GasFlowAggregatedFrom = ""
            GasFlowAggregatedTo = ""
            for operator_name in configData[_type]['operator_points']:
                for pubIP in configData[_type]['operator_points'][operator_name]:
                    pubip= pubIP
                    sheetIP = configData[_type]['op_details'][pubIP][0]
                    GasQuality = configData[_type]['op_details'][pubIP][2]
                    if configData['production']['gas-day']:
                        if day<=-1:
                            try:

                                state='Provisional'
                            
                                base_time = datetime.datetime.strptime(date[:10], "%Y-%m-%d").strftime("%m/%d/%Y")
                                total_energy = Values['day'].get(sheetIP, {}).get(base_time, {}).get("Entry", {}).get("flow",'')
                                # exit_gf= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Exit", {}).get("flow",'')
                                gcv_entry= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Entry", {}).get("gcv", '')
                                gcv_exit= Values['day'].get(sheetIP, {}).get(base_time, {}).get("Exit", {}).get("gcv", '')
                                
                                if not gcv_exit:
                                    gcv_exit= configData['production']['gcv'][pubip]['value']
                                if not gcv_entry:
                                    gcv_entry=configData['production']['gcv'][pubip]['value']
                            
                                if (total_energy==None or total_energy=='') :
                                    state='Missing'
                                
                                if(chk_date in configData[_type]['skipData'][pubIP] or chk_date in configData[_type]['skipData']["All"]):continue
                            
                                elif(chk_date in configData[_type]['missingData'][pubIP] or chk_date in configData[_type]['missingData']["All"] or state=="Missing"):
                                    pm.file_write(Rawdata_Prod, "a", f"{operator_name}|{pubIP}|{from_period}|{to_period}|gas-day|{r_g}|{GMT}||Missing|{GasQuality}|||||||||New\n")  
                                    
                                elif (chk_date in configData[_type]['emptyProvisionalData'][pubIP] or chk_date in configData[_type]['emptyProvisionalData']["All"]):
                                    pm.file_write(Rawdata_Prod, "a", f"{operator_name}|{pubIP}|{from_period}|{to_period}|gas-day|{r_g}|{GMT}||Provisional|{GasQuality}|||||||||New\n")  
                                    
                                else: 
                                    pm.file_write(Rawdata_Prod, "a", f"{operator_name}|{pubIP}|{from_period}|{to_period}|gas-day|{r_g}|{GMT}||{state}|{GasQuality}|{total_energy}|kwh|||||{gcv_entry}|kWh/Nm3|New\n")
                            except:
                                pm.file_write(Rawdata_Prod, "a", f"{operator_name}|{pubIP}|{from_period}|{to_period}|gas-day|{r_g}|{GMT}||Missing|{GasQuality}|||||||||New\n")  
                                
                    if configData['production']['intra-day']:
                        for row in range(0, GasHour + 1):  # or use range(0, 24)
                                # try:
                                    gas_hour=row+1
                                    state = State_nom = State_renom = 'Provisional'
                                    gasday_label = GasDay_dt + datetime.timedelta(hours=row + 6)
                                    gashour = gasday_label.strftime("%H")
                                    # Get PeriodFrom and PeriodTo
                                    gasday_time = GasDay_dt + datetime.timedelta(hours=row + 5)
                                    PeriodFrom_1 = gasday_time.strftime("%Y-%m-%d %H:00:00.000")
                                    PeriodTo_dt = gasday_time + datetime.timedelta(hours=1)
                                    PeriodTo = PeriodTo_dt.strftime("%Y-%m-%d %H:00:00.000")
                                    if day != 0 and GasFlowAggregatedFrom == "":
                                        GasFlowAggregatedFrom = PeriodFrom_1
                                        GasFlowAggregatedTo = (GasDay_dt + datetime.timedelta(days=1)).strftime("%Y-%m-%d 00:00:00.000")
                                    # Convert to mm/dd/yyyy HH:00 for lookup
                                    
                                    
                                    match_from = PeriodTo_dt.strftime("%m/%d/%Y %H:00")
                                    total_energy_hr = Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Entry", {}).get("flow",'')
                                    exit_gf_hr = Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Exit", {}).get("flow",'')
                                    gcv_exit= Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Entry", {}).get("gcv", '')
                                    gcv_entry= Values['hour'].get(sheetIP, {}).get(match_from, {}).get("Exit", {}).get("gcv", '')
                                    gcv_entry= Values['hour'].get(sheetIP, {}).get(base_time, {}).get("Entry", {}).get("gcv", '')
                                    gcv_exit= Values['hour'].get(sheetIP, {}).get(base_time, {}).get("Exit", {}).get("gcv", '')
                                    
                                    if not gcv_exit:
                                        gcv_exit= configData['production']['gcv'][pubip]['value']
                                    if not gcv_entry:
                                        gcv_entry=configData['production']['gcv'][pubip]['value']
                                
                                    if (total_energy_hr==None or total_energy_hr=='') :
                                        state='Missing'
                                    
                                    if(chk_date in configData[_type]['skipData'][pubIP] or chk_date in configData[_type]['skipData']["All"]):continue
                        
                                    elif( state=="Missing"):
                                        pm.file_write(Rawdata_Prod, "a", f"{operator_name}|{pubIP}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|{GMT}||Missing|{GasQuality}|||||||||New\n")  
                                        
                                    # elif (chk_date in configData[_type]['emptyProvisionalData'][pubIP] or chk_date in configData[_type]['emptyProvisionalData']["All"]):
                                    #     pm.file_write(Rawdata_Prod, "a", f"{operator_name}|{pubIP}|{PeriodFrom_1}|{to_period}|gas-day|{r_g}|{GMT}||Provisional|{GasQuality}|||||||||New\n")  
                                        
                                    else: 
                                        pm.file_write(Rawdata_Prod, "a", f"{operator_name}|{pubIP}|{PeriodFrom_1}|{PeriodTo}|intra-day|{gas_hour}|{GMT}||{state}|{GasQuality}|{total_energy_hr}|kwh|||||{gcv_entry}|kWh/Nm3|New\n")


if __name__ == '__main__':
    
    try:
        try: serverIP = pm.serverIP()
        except IndexError:
            print("Give 'Server IP' as input argument after the script name in cmd prompt")
            sys.exit(1)

        configData = json.load(open('Config_TSO13_GasunieDeutschland.json','r',encoding='utf-8'))
        if not configData['scriptRunStatus']:
            print('Script exit')
            sys.exit(1) 

        cls_obj = ICIS_Class(configData)
        IP_mapping = configData['IP_mapping']
        
        Rawdata_TSO =f"{configData['operatorId']}_TSO32_Gasflow_GasunieDeutschland_{serverIP}_{cls_obj.gasHour}_{cls_obj.fileDate}.txt"
        Rawdata_NOM =f"{configData['operatorId']}_TSO32_Nomination_GasunieDeutschland_{serverIP}_{cls_obj.gasHour}_{cls_obj.fileDate}.txt"
        Rawdata_RENOM =f"{configData['operatorId']}_TSO32_Renomination_GasunieDeutschland_{serverIP}_{cls_obj.gasHour}_{cls_obj.fileDate}.txt"
        Rawdata_Prod =f"{configData['operatorId']}_TSO32_Production_GasunieDeutschland_{serverIP}_{cls_obj.gasHour}_{cls_obj.fileDate}.txt"
        
        pm.file_write(Rawdata_TSO, "w", '|'.join(configData['gasflow']['header'])+'\n')
        pm.file_write(Rawdata_NOM, "w", '|'.join(configData['nomination']['header'])+'\n')
        pm.file_write(Rawdata_RENOM, "w", '|'.join(configData['renomination']['header'])+'\n')
        pm.file_write(Rawdata_Prod, "w", '|'.join(configData['production']['header'])+'\n')
        
        cls_obj.readingBlock('gasflow')
        cls_obj.writingBlock_Gasflow('gasflow')
        cls_obj.writingBlock_Nomination('nomination')
        cls_obj.writingBlock_Renomination('renomination')
        cls_obj.writingBlock_Production('production')
        
    except Exception as error:
        pm.errorMail(serverIP,traceback.format_exc(), cls_obj.mail_data)
        print(traceback.format_exc())
        cls_obj.missingPush()
        
    folderDate = cls_obj.folderDate
    datasets={"gasflow": Rawdata_TSO, "nomination": Rawdata_NOM, "renomination": Rawdata_RENOM,"production":Rawdata_Prod}
    for dataset, file in datasets.items():
        if configData[dataset]['outputMove']:shutil.move(file,configData[dataset]['outputPath'])
        
