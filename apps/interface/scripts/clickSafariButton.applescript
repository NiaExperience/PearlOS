on run argv
  if count of argv is less than 1 then
    return "Error: No data-testid provided."
  end if
  set buttonTestId to item 1 of argv
  
  tell application "Safari"
    activate -- Bring Safari to the front
    
    -- This assumes index.html is in the frontmost window and tab.
    -- You might need more specific targeting if Safari has many windows/tabs.
    try
      tell front document
        -- Use do JavaScript to find and click the button
        -- Make sure the page is fully loaded and the button exists
        do JavaScript "document.querySelector('[data-testid=\"" & buttonTestId & "\"]').click();"
      end tell
      return "Successfully clicked button with data-testid: " & buttonTestId
    on error errMsg number errNum
      return "Error interacting with Safari: " & errMsg & " (Number: " & errNum & ")"
    end try
  end tell
end run