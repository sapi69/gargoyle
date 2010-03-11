/*
 * This program is copyright � 2008 Eric Bishop and is distributed under the terms of the GNU GPL 
 * version 2.0 with a special clarification/exception that permits adapting the program to 
 * configure proprietary "back end" software provided that all modifications to the web interface
 * itself remain covered by the GPL. 
 * See http://gargoyle-router.com/faq.html#qfoss for more information
 */

var updateInProgress = false;
var timeSinceUpdate = -5000;

function resetData()
{
	setSelectedValue("refresh_rate", "10000");
	resetVariables();
	setInterval(checkForRefresh, 500); 
}

function checkForRefresh()
{
	timeSinceUpdate = timeSinceUpdate + 500;
	
	var refreshRate = getSelectedValue("refresh_rate");
	var refreshRate = refreshRate == "never" ? timeSinceUpdate+500 : refreshRate;
	if(timeSinceUpdate < 0 || timeSinceUpdate >= refreshRate)
	{
		timeSinceUpdate = 0;
		reloadVariables();
	}
}


function reloadVariables()
{
	if(!updateInProgress)
	{
		updateInProgress = true;
		var param = getParameterDefinition("commands", "sh /usr/lib/gargoyle/define_host_vars.sh") + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

		var stateChangeFunction = function(req) 
		{ 
			if(req.readyState == 4) 
			{
				var jsHostVars = req.responseText.replace(/Success/, "");
				eval(jsHostVars);
				resetVariables();
				updateInProgress = false;
			}
		}
		runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
	}
}
function resetVariables()
{
	if(uciOriginal.get("dhcp", "lan", "ignore") != "1")
	{
		document.getElementById("dhcp_data").style.display="block";
		var columnNames=["Hostname", "Host IP", "Host MAC", "Lease Expires"];
		var table = createTable(columnNames, parseDhcp(dhcpLeaseLines), "lease_table", false, false);
		var tableContainer = document.getElementById('lease_table_container');
		if(tableContainer.firstChild != null)
		{
			tableContainer.removeChild(tableContainer.firstChild);
		}
		tableContainer.appendChild(table);
	}
	else
	{
		document.getElementById("dhcp_data").style.display="none";
	}

	var arpHash = parseArp(arpLines, dhcpLeaseLines);
	
	var apFound = false;
	var wifiIfs = uciOriginal.getAllSectionsOfType("wireless", "wifi-iface");
	var ifIndex = 0;
	for(ifIndex = 0; ifIndex < wifiIfs.length; ifIndex++)
	{
		apFound = uciOriginal.get("wireless", wifiIfs[ifIndex], "mode") == "ap" ? true : apFound;
	}
	var wifiDevs = uciOriginal.getAllSectionsOfType("wireless", "wifi-device");
	apFound = apFound && (uciOriginal.get("wireless", wifiDevs[0], "disabled") != "1");
	
	if(apFound)
	{
		document.getElementById("wifi_data").style.display="block";
		var columnNames=["Hostname", "Host IP", "Host MAC"];
		var table = createTable(columnNames, parseWifi(arpHash, isBrcm, wifiLines), "wifi_table", false, false);
		var tableContainer = document.getElementById('wifi_table_container');
		if(tableContainer.firstChild != null)
		{
			tableContainer.removeChild(tableContainer.firstChild);
		}
		tableContainer.appendChild(table);
	}
	else
	{
		document.getElementById("wifi_data").style.display="none";
	}
	
	var columnNames=["Hostname", "Host IP", "Host MAC", "Active TCP Cxns", "Recent TCP Cxns", "UDP Cxns"];
	var table = createTable(columnNames, parseConntrack(arpHash, currentWanIp, conntrackLines), "active_table", false, false);
	var tableContainer = document.getElementById('active_table_container');
	if(tableContainer.firstChild != null)
	{
		tableContainer.removeChild(tableContainer.firstChild);
	}
	tableContainer.appendChild(table);
	
}

function getHostname(ip)
{
	var hostname = ipToHostname[ip] == null ? "(unknown)" : ipToHostname[ip];
	hostname = hostname.length < 25 ? hostname : hostname.substr(0,22)+"...";
	return hostname;
}

function parseDhcp(leases)
{
	//HostName, Host IP, Host MAC, Time Before Expiration	
	var dhcpTableData = [];
	var lineIndex=0;
	for(lineIndex=0; lineIndex < leases.length; lineIndex++)
	{
		var leaseLine = leases[lineIndex];
		var splitLease = leaseLine.split(/[\t ]+/);
		var expTime = splitLease[0];
		var mac = splitLease[1].toUpperCase();
		var ip = splitLease[2];
		
		var hostname = getHostname(ip);			

		var seconds = expTime - currentTime;
		var expHours = Math.floor(seconds/(60*60));
		var expMinutes = Math.floor((seconds-(expHours*60*60))/(60));
		if(expMinutes < 10)
		{
			expMinutes = "0" + expMinutes;
		}
		var exp = expHours + "h " + expMinutes + "m";

		dhcpTableData.push( [hostname, ip, mac, exp ] );
	}
	sort2dStrArr(dhcpTableData, 1);
	return dhcpTableData;
}

function parseArp(arpLines, leaseLines)
{
	var arpHash = [];
	
	arpLines.shift(); //skip header
	var lineIndex = 0;
	for(lineIndex=0; lineIndex < arpLines.length; lineIndex++)
	{
		var nextLine = arpLines[lineIndex];
		var splitLine = nextLine.split(/[\t ]+/);
		var mac = splitLine[3].toUpperCase();
		var ip = splitLine[0];
		arpHash[ mac ] = ip;
		arpHash[ ip  ] = mac;
	}
	

	for(lineIndex=0; lineIndex < leaseLines.length; lineIndex++)
	{
		var leaseLine = leaseLines[lineIndex];
		var splitLease = leaseLine.split(/[\t ]+/);
		var mac = splitLease[1].toUpperCase();
		var ip = splitLease[2];
		arpHash[ mac ] = ip;
		arpHash[ ip  ] = mac;
	}

	return arpHash;
}

function sort2dStrArr(arr, testIndex)
{
	var str2dSort = function(a,b){  return a[testIndex] == b[testIndex] ? 0 : (a[testIndex] < b[testIndex] ? -1 : 1);  }
	arr.sort(str2dSort);
}

function parseWifi(arpHash, isBrcm, lines)
{
	//Host IP, Host MAC
	var wifiTableData = [];
	var lineIndex = 0;
	if(!isBrcm)
	{
		lines.shift();
	}
	for(lineIndex=0; lineIndex < lines.length; lineIndex++)
	{
		var nextLine = lines[lineIndex];
		var splitLine = nextLine.split(/[\t ]+/);
		var mac = isBrcm ? splitLine[1].toUpperCase() : splitLine[0].toUpperCase();
		var ip = arpHash[ mac ] == null ? "unknown" : arpHash[ mac ] ;
		var hostname = getHostname(ip);			
		wifiTableData.push( [ hostname, ip, mac ] );
	}
	sort2dStrArr(sortWifi, 1);
	return wifiTableData;
}

function parseConntrack(arpHash, currentWanIp, lines)
{
	//Host IP, Host MAC, current TCP cnxns, recently closed TCP cnxns, UDP cnxns
	var activeTableData = [];
	var ipHash = [];
	var protoHash = [];
	var ipList = [];
	var lineIndex = 0;
	for(lineIndex=0; lineIndex < lines.length; lineIndex++)
	{
		var nextLine = lines[lineIndex];
		
		var splitLine = nextLine.split(/src=/); //we want FIRST src definition
		var srcIpPart = splitLine[1];
		var splitSrcIp = srcIpPart.split(/[\t ]+/);
		var srcIp = splitSrcIp[0];
		
		splitLine = nextLine.split(/dst=/); //we want FIRST dst definition
		var dstIpPart = splitLine[1];
		var splitDstIp = dstIpPart.split(/[\t ]+/);
		var dstIp = splitDstIp[0];
		
		
		
		splitLine=nextLine.split(/[\t ]+/);
		var proto = splitLine[0].toLowerCase();
		if(proto == "tcp")
		{
			var state = splitLine[3].toUpperCase();
			var stateStr = state == "TIME_WAIT" || state == "CLOSE" ? "closed" : "open";
			proto = proto + "-" + stateStr;
		}
		protoHash[ srcIp + "-" + proto ] =  protoHash[ srcIp + "-" + proto ] == null ? 1 : protoHash[ srcIp + "-" + proto ] + 1;
		if(proto == "udp")
		{
			var num = protoHash[ srcIp + "-" + proto ];
		}	
			
		//for some reason I'm seeing src ips of 0.0.0.0 -- WTF???
		//exclude anything starting at router, or ending at external wan ip, since this is probably a connection to router from outside
		if(ipHash[srcIp] == null && srcIp != currentWanIp && srcIp != currentLanIp && dstIp != currentWanIp && srcIp != "0.0.0.0")
		{
			ipList.push(srcIp);
			ipHash[srcIp] = 1;
		}
	}


	var ipIndex = 0;
	for(ipIndex = 0; ipIndex < ipList.length; ipIndex++)
	{
		var ip        = ipList[ipIndex];
		var mac       = arpHash[ip] == null ? "unknown" : arpHash[ip];
		var tcpOpen   = protoHash[ ip + "-tcp-open" ] == null   ? 0 : protoHash[ ip + "-tcp-open" ];
		var tcpClosed = protoHash[ ip + "-tcp-closed" ] == null  ? 0 : protoHash[ ip + "-tcp-closed" ];
		var udp       = protoHash[ ip + "-udp" ] == null ? 0 : protoHash[ ip + "-udp" ];
		var hostname  = getHostname(ip);			
		activeTableData.push( [ hostname, ip, mac, ""+tcpOpen, ""+tcpClosed, ""+udp ] );
	}
	sort2dStrArr(activeTableData, 1);
	return activeTableData;
}


