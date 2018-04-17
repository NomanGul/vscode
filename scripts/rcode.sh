#!/usr/bin/env bash

function toWindows () {
	result=${1//\/mnt\//}
	result=$(echo $result | sed 's/^\(.\)\//\1:\//')
	result=${result//\//\\}
	echo $result
}

command=$(toWindows "$(dirname "$(realpath "$0")")")
command="$command\\code.bat"

workspace=$(toWindows "$1")

cmd.exe /s /c "$command $workspace $2 $3 $4 $5 >nul 2>nul <nul"