// Editable brand masters; desktop, mobile and installer assets share these shapes.
import { writeFile } from 'node:fs/promises';
const shell = `<path d="M190 83 143 56Q129 48 116 56L68 84Q58 90 58 103V164Q58 177 70 184L115 210Q128 217 141 210L187 184Q200 177 189 166L170 155 139 173Q129 179 119 173L98 161Q94 159 94 153V114Q94 109 99 106L119 94Q129 88 139 94L168 111Q177 116 185 107L195 96Q200 89 190 83Z" fill="url(#mark)"/>
<path d="M58 111V164Q58 177 70 184L115 210Q128 217 141 210L187 184Q194 180 194 176L149 184Q130 190 112 179L95 169 80 130Z" fill="url(#facet)" opacity=".5"/>
<path d="m119 119 17 16-17 17m29 0h18" fill="none" stroke="#f6fbff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
const agent = `<path d="m166 70-23-14q-15-8-29 0L69 82Q57 89 57 103v62q0 13 12 20l46 27q13 7 25 0l24-14q10-6 0-13l-27-15q-9 5-17 0l-21-12q-5-3-5-9v-34q0-6 5-9l20-12q10-6 20 0l27-16q10-4 0-8Z" fill="url(#mark)"/>
<path d="M57 110v55q0 13 12 20l46 27q13 7 25 0l24-14q10-6 0-13l-27-15-17 5-22-15-15-30Z" fill="url(#facet)" opacity=".48"/>
<g fill="url(#mark)"><rect x="143" y="126" width="13" height="13" rx="3"/><rect x="166" y="116" width="28" height="28" rx="5"/><rect x="205" y="101" width="19" height="19" rx="4"/><rect x="205" y="138" width="18" height="18" rx="4" opacity=".38"/></g>
<path d="m176 130 7-5 7 5-7 7Z" fill="#008d7c" opacity=".6"/>`;
function svg(isAgent, pro) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs>
<linearGradient id="bg" x2="1" y2="1"><stop stop-color="${isAgent?'#00594b':'#273b51'}"/><stop offset=".58" stop-color="${isAgent?'#003d32':'#0c1721'}"/><stop offset="1" stop-color="${isAgent?'#001d17':'#080b0e'}"/></linearGradient>
<linearGradient id="mark" x1=".8" y1="0" x2=".2" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="${isAgent?'#c5f8e7':'#25cdef'}"/><stop offset=".44" stop-color="${isAgent?'#25d8bc':'#298eff'}"/><stop offset="1" stop-color="${isAgent?'#008375':'#2450ff'}"/></linearGradient>
<linearGradient id="facet" x2="1" y2=".4"><stop stop-color="${isAgent?'#006e65':'#1154e3'}"/><stop offset=".52" stop-color="${isAgent?'#00e2bd':'#1d6eff'}"/><stop offset="1" stop-color="${isAgent?'#004638':'#14246e'}"/></linearGradient>
<linearGradient id="gold" x2=".3" y2="1"><stop stop-color="#ffe7a5"/><stop offset=".5" stop-color="#ffd475"/><stop offset="1" stop-color="#d89b20"/></linearGradient>
</defs>
<rect x="8" y="8" width="240" height="240" rx="54" fill="url(#bg)"/>
${!isAgent?'<rect x="49" y="42" width="160" height="174" rx="27" fill="#12365a" opacity=".34"/>':''}
${isAgent?agent:shell}
${pro?'<rect x="146" y="178" width="83" height="49" rx="15" fill="url(#gold)"/><text x="187.5" y="211" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="800" fill="#09151b">PRO</text>':''}
</svg>\n`;
}
for(const [name,isAgent,pro] of [['icon',false,false],['cagent-icon',true,false],['brand/cshell',false,false],['brand/cagent',true,false],['brand/cshell-pro',false,true],['brand/cagent-pro',true,true]])await writeFile(`assets/${name}.svg`,svg(isAgent,pro));

