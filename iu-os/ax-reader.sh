#!/bin/bash
# AX Reader - Captures UI elements from frontmost app

osascript << 'APPLESCRIPT'
use scripting additions

set jsonResult to "{"

try
    tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        
        set jsonResult to jsonResult & "\"app\":\"" & appName & "\","
        
        if (count of windows of frontApp) > 0 then
            set frontWin to first window of frontApp
            set winName to name of frontWin
            if winName is missing value then set winName to "Untitled"
            
            set jsonResult to jsonResult & "\"window\":\"" & my escapeStr(winName) & "\","
            set jsonResult to jsonResult & "\"snapshot\":["
            
            set elementId to 0
            set firstElem to true
            
            -- Get all UI elements recursively (up to 3 levels)
            set allElems to every UI element of frontWin
            
            repeat with elem in allElems
                if elementId < 40 then
                    try
                        set r to role of elem
                        
                        -- Direct elements
                        if r is "AXButton" then
                            set n to ""
                            try
                                set n to name of elem
                            end try
                            if n is not missing value and n is not "" then
                                set elementId to elementId + 1
                                if not firstElem then set jsonResult to jsonResult & ","
                                set firstElem to false
                                set jsonResult to jsonResult & "{\"id\":\"" & elementId & "\",\"type\":\"button\",\"label\":\"" & my escapeStr(n) & "\"}"
                            end if
                        end if
                        
                        -- Recurse into containers
                        if r contains "Group" or r contains "Toolbar" or r contains "SplitGroup" or r contains "ScrollArea" then
                            set subElems to every UI element of elem
                            repeat with subElem in subElems
                                if elementId < 40 then
                                    try
                                        set sr to role of subElem
                                        
                                        if sr is "AXButton" then
                                            set sn to ""
                                            try
                                                set sn to name of subElem
                                            end try
                                            if sn is not missing value and sn is not "" then
                                                set elementId to elementId + 1
                                                if not firstElem then set jsonResult to jsonResult & ","
                                                set firstElem to false
                                                set jsonResult to jsonResult & "{\"id\":\"" & elementId & "\",\"type\":\"button\",\"label\":\"" & my escapeStr(sn) & "\"}"
                                            end if
                                        else if sr is "AXStaticText" then
                                            set sv to ""
                                            try
                                                set sv to value of subElem
                                            end try
                                            if sv is not missing value and sv is not "" and (length of (sv as text)) < 80 then
                                                set elementId to elementId + 1
                                                if not firstElem then set jsonResult to jsonResult & ","
                                                set firstElem to false
                                                set jsonResult to jsonResult & "{\"id\":\"" & elementId & "\",\"type\":\"text\",\"label\":\"" & my escapeStr(sv) & "\"}"
                                            end if
                                        else if sr is "AXTextField" then
                                            set sv to ""
                                            try
                                                set sv to value of subElem
                                            end try
                                            set elementId to elementId + 1
                                            if not firstElem then set jsonResult to jsonResult & ","
                                            set firstElem to false
                                            set jsonResult to jsonResult & "{\"id\":\"" & elementId & "\",\"type\":\"input\",\"label\":\"" & my escapeStr(sv) & "\"}"
                                        else if sr contains "Group" or sr contains "List" then
                                            -- Level 3
                                            set subSubElems to every UI element of subElem
                                            repeat with ssElem in subSubElems
                                                if elementId < 40 then
                                                    try
                                                        set ssr to role of ssElem
                                                        if ssr is "AXButton" then
                                                            set ssn to ""
                                                            try
                                                                set ssn to name of ssElem
                                                            end try
                                                            if ssn is not missing value and ssn is not "" then
                                                                set elementId to elementId + 1
                                                                if not firstElem then set jsonResult to jsonResult & ","
                                                                set firstElem to false
                                                                set jsonResult to jsonResult & "{\"id\":\"" & elementId & "\",\"type\":\"button\",\"label\":\"" & my escapeStr(ssn) & "\"}"
                                                            end if
                                                        else if ssr is "AXStaticText" then
                                                            set ssv to ""
                                                            try
                                                                set ssv to value of ssElem
                                                            end try
                                                            if ssv is not missing value and ssv is not "" and (length of (ssv as text)) < 80 then
                                                                set elementId to elementId + 1
                                                                if not firstElem then set jsonResult to jsonResult & ","
                                                                set firstElem to false
                                                                set jsonResult to jsonResult & "{\"id\":\"" & elementId & "\",\"type\":\"text\",\"label\":\"" & my escapeStr(ssv) & "\"}"
                                                            end if
                                                        else if ssr is "AXLink" then
                                                            set ssn to ""
                                                            try
                                                                set ssn to value of attribute "AXTitle" of ssElem
                                                            end try
                                                            if ssn is not missing value and ssn is not "" then
                                                                set elementId to elementId + 1
                                                                if not firstElem then set jsonResult to jsonResult & ","
                                                                set firstElem to false
                                                                set jsonResult to jsonResult & "{\"id\":\"" & elementId & "\",\"type\":\"link\",\"label\":\"" & my escapeStr(ssn) & "\"}"
                                                            end if
                                                        end if
                                                    end try
                                                end if
                                            end repeat
                                        end if
                                    end try
                                end if
                            end repeat
                        end if
                    end try
                end if
            end repeat
            
            set jsonResult to jsonResult & "]"
        else
            set jsonResult to jsonResult & "\"window\":null,\"snapshot\":[],\"error\":\"No windows\""
        end if
    end tell
    
on error errMsg
    set jsonResult to jsonResult & "\"error\":\"" & my escapeStr(errMsg) & "\""
end try

set jsonResult to jsonResult & "}"
return jsonResult

on escapeStr(theText)
    if theText is missing value then return ""
    set theText to theText as text
    set theText to my replaceChars(theText, "\\", "\\\\")
    set theText to my replaceChars(theText, "\"", "\\\"")
    set theText to my replaceChars(theText, return, " ")
    set theText to my replaceChars(theText, linefeed, " ")
    return theText
end escapeStr

on replaceChars(theText, searchStr, replaceStr)
    set AppleScript's text item delimiters to searchStr
    set theItems to text items of theText
    set AppleScript's text item delimiters to replaceStr
    set theResult to theItems as text
    set AppleScript's text item delimiters to ""
    return theResult
end replaceChars
APPLESCRIPT
