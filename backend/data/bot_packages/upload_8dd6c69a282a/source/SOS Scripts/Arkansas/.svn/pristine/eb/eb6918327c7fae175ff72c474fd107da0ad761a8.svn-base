import subprocess
import sys
import ftplib
import shutil
import os

FTP_Upload_Flag='Yes'
Server_IP1='174.142.250.240'
Server_Username1='perlzuser'
Server_Password1='j2wSPxRi'
ftpOutputPath2='/SD/SP/SOS_2024/2703/Status'

def ipaddress():
	if os.path.isfile('C:/SD/ip.txt'):
		file = open('C:/SD/ip.txt', 'r')
		systemIp = file.read()
		file.close()
		print('Ip Address is '+str(systemIp))
	else:
		systemIp = socket.gethostbyname(socket.gethostname())
		systemIp = re.sub('[\D]+', '.', systemIp, flags=re.I|re.M)
		print('Ip Address is '+str(systemIp))
	return systemIp

def ftpUpload(serverIP,userName,password,ftpPath,fileName):
	ftp = ftplib.FTP(serverIP, userName, password)
	
	try:
		ftp.mkd(ftpPath)
	except:
		pass
	
	try:
		tempFileName= os.path.basename(fileName)
		gFile = open(fileName, 'rb')
		ftp.storbinary('STOR ' + ftpPath + '/' + tempFileName, gFile)
		gFile.close()
	except:
		pass

	ftp.quit()

def install_module(module_name):
	"""Install a Python module using pip."""
	try:
		subprocess.check_call([sys.executable, "-m", "pip", "install", module_name])
		print(f"'{module_name}' installed successfully!")
	except subprocess.CalledProcessError as e:
		print(f"Failed to install '{module_name}'. Error: {e}")

# Install the anticaptchaofficial module
install_module("anticaptchaofficial")
systemIp=ipaddress()

if FTP_Upload_Flag == 'Yes':
	com_file=str(systemIp)+"_Completed.txt" 
	com_result='Completed'
	file = open(com_file, 'a', encoding='utf-8')
	file.write(str(com_result)+'\n')
	file.close()
	ftpUpload(Server_IP1,Server_Username1,Server_Password1,ftpOutputPath2,com_file)
