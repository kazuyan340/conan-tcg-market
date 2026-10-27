#!/bin/bash
# usage: runv.sh idsfile outprefix
cd "C:/Users/kazuyan/Desktop/オリジナル/conan/conan-card-game"
SP="C:/Users/kazuyan/AppData/Local/Temp/claude/c--Users-kazuyan-Desktop-------conan/75da273e-2e45-4d68-831c-23a042400a50/scratchpad"
node -e "
const fs=require('fs');const sp=process.argv[1];const ids=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
for(let i=0;i<4;i++)fs.writeFileSync(sp+'/vids'+i+'.json',JSON.stringify(ids.filter((x,k)=>k%4===i)))" "$SP" "$1"
rm -f $SP/vout*.txt
for i in 0 1 2 3; do rm -rf $SP/vud$i; cp -r $SP/ud4 $SP/vud$i; (env -u ELECTRON_RUN_AS_NODE timeout 3000 ./node_modules/electron/dist/electron.exe $SP/verify.js "$(pwd)" "$SP/vud$i" "$SP/vids$i.json" > $SP/vout$i.txt 2>&1 &) ; done
