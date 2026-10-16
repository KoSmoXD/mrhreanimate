-- Mr H Reanimate UI Changer v1: Original / Obsidian / Linoria.
-- Native library windows mirror underlying Uhhhhhh controls. Original UI remains
-- the authoritative control surface and is restored if a library cannot load.
-- This module is installed before MainPage creation, and runs in its own closure.
return function(UI, originalWindow, saved)
    local BRIDGE = {
        pages = {}, lookup = {}, lastId = 0, style = 1,
        library = nil, window = nil, rendering = false, rebuilding = false,
        syncConnections = {},
        current = nil, lastNotice = "",
    }
    local services = game:GetService("HttpService")
    local LIBRARIES = {
        [2] = "https://raw.githubusercontent.com/deividcomsono/Obsidian/82d402b5de7d8903915f1afe99b5b7e340e7cd28/Library.lua",
        [3] = "https://raw.githubusercontent.com/violin-suzutsuki/LinoriaLib/1be38aa599bb1f6a7c28f47e6fc13ade52dd0acd/Library.lua",
    }
    local names = {"Original", "Obsidian", "Linoria"}
    local function caption(text)
        local s = tostring(text or "")
        s = s:gsub("<[^>]+>", ""):gsub("&lt;", "<"):gsub("&gt;", ">")
        s = s:gsub("&amp;", "&"):gsub("[%c]", " "):gsub("%s+", " ")
        return s:sub(1, 125)
    end
    local function pageFor(parent)
        local object = parent
        while typeof(object) == "Instance" do
            if BRIDGE.lookup[object] then return BRIDGE.lookup[object] end
            object = object.Parent
        end
        return nil
    end
    local function add(parent, kind, label, data)
        if kind == "dropdown" and label == "UI Changer" then return end
        local page = pageFor(parent)
        if not page then return end
        BRIDGE.lastId += 1
        local item = data or {}
        item.id = BRIDGE.lastId
        item.kind = kind
        item.label = caption(label)
        item.container = parent
        table.insert(page.items, item)
        BRIDGE:queueRefresh()
        return item
    end
    function BRIDGE:SetSelector(selector)
        self.selector = selector
    end
    function BRIDGE:SetTitle(page, title)
        local info = self.lookup[page]
        if info then info.title = caption(title) end
    end
    local oldPage = UI.CreatePage
    UI.CreatePage = function(...)
        local frame = oldPage(...)
        local info = {page = frame, title = "Page " .. (#BRIDGE.pages + 1), items = {}}
        if #BRIDGE.pages == 0 then info.title = "Main" end
        BRIDGE.lookup[frame] = info
        table.insert(BRIDGE.pages, info)
        BRIDGE:queueRefresh()
        return frame
    end
    local oldButton = UI.CreateButton
    UI.CreateButton = function(parent, label, size)
        local button, text = oldButton(parent, label, size)
        -- Never replace a Roblox GuiButton with a Lua proxy table. Upstream
        -- stores, compares and modifies these Instances during initialization.
        -- Returning a proxy was capable of breaking engine startup.
        add(parent, "button", label, {value = button, text = text})
        return button, text
    end
    local oldText = UI.CreateText
    UI.CreateText = function(parent, text, size, align)
        local label = oldText(parent, text, size, align)
        local page = pageFor(parent)
        if page and parent == page.page and page.title:match("^Page %d+") then
            local name = caption(text)
            if #name > 3 and #name < 42 then page.title = name end
        end
        if size and size >= 11 then
            local name = caption(text)
            if #name >= 4 and #name <= 85 and name:match("%a") then
                add(parent, "label", name, {value = label})
            end
        end
        return label
    end
    local oldToggle = UI.CreateSwitch
    UI.CreateSwitch = function(parent, label, value)
        local toggle, text = oldToggle(parent, label, value)
        add(parent, "toggle", label, {value = toggle})
        return toggle, text
    end
    local oldSlider = UI.CreateSlider
    UI.CreateSlider = function(parent, label, value, min, max, step)
        local slider = oldSlider(parent, label, value, min, max, step)
        add(parent, "slider", label, {value = slider, min = min or 1, max = max or 10, step = step or 0})
        return slider
    end
    local oldDropdown = UI.CreateDropdown
    UI.CreateDropdown = function(parent, label, values, current)
        local dropdown, text = oldDropdown(parent, label, values, current)
        add(parent, "dropdown", label, {value = dropdown, choices = table.clone(values)})
        return dropdown, text
    end
    local oldInput = UI.CreateTextbox
    UI.CreateTextbox = function(parent, text, placeholder, size)
        local input = oldInput(parent, text, placeholder, size)
        add(parent, "input", placeholder ~= "" and placeholder or "Text", {value = input})
        return input
    end
    local function fromRemote(style)
        local url = LIBRARIES[style]
        if not url then return nil, "Unknown style" end
        local ok, data = pcall(function() return game:HttpGet(url) end)
        if not ok or type(data) ~= "string" or #data < 30000 then
            return nil, "Cannot download " .. names[style] .. " library."
        end
        local compiled, err = loadstring(data, "MrH_" .. names[style])
        if type(compiled) ~= "function" then return nil, "Library compile failed: " .. tostring(err) end
        local ran, library = pcall(compiled)
        if not ran or type(library) ~= "table" then
            return nil, "Library initialization failed: " .. tostring(library)
        end
        return library
    end
    local function precision(step)
        if not step or step <= 0 then return 2 end
        local digits = 0
        while digits < 3 and math.abs(step * 10 ^ digits - math.round(step * 10 ^ digits)) > 0.00001 do
            digits += 1
        end
        return digits
    end
    local function attach(group, item, library)
        -- Uhhhhhh stores BoolValue, IntValue and NumberValue without parents.
        -- They are valid sources even when not parented in the DataModel.
        local label = item.label
        if label == "" then return end
        local idx = "mrh_" .. item.id
        local ok, result = pcall(function()
            if item.kind == "label" then
                if #label < 82 then return group:AddLabel(label) end
            elseif item.kind == "button" then
                return group:AddButton(label, function()
                    local button = item.value
                    if not button or not button.Parent then return end
                    local invoked = false
                    if type(getconnections) == "function" then
                        local ok, listeners = pcall(getconnections, button.Activated)
                        if ok and type(listeners) == "table" then
                            for _, listener in ipairs(listeners) do
                                local active = listener.Enabled ~= false
                                if active then
                                    local okFire = false
                                    if type(listener.Fire) == "function" then
                                        okFire = pcall(function() listener:Fire() end)
                                    elseif type(listener.Function) == "function" then
                                        okFire = pcall(listener.Function)
                                    end
                                    invoked = invoked or okFire
                                end
                            end
                        end
                    end
                    if not invoked then
                        -- Built-in UI events cannot be fired by plain Roblox APIs.
                        -- Return to the native control instead of simulating an action.
                        local page = pageFor(button)
                        BRIDGE:SetStyle(1)
                        if page then BRIDGE:activatePage(page.page) end
                    end
                end)
            elseif item.kind == "toggle" then
                local result = group:AddToggle(idx, {
                    Text = label, Default = item.value.Value,
                    Callback = function(v) item.value.Value = not not v end
                })
                return result
            elseif item.kind == "slider" then
                local result = group:AddSlider(idx, {
                    Text = label, Default = item.value.Value,
                    Min = item.min, Max = item.max, Rounding = precision(item.step),
                    Callback = function(v)
                        local n = tonumber(v)
                        if n then
                            n = math.clamp(n, item.min, item.max)
                            if item.step > 0 then
                                n = math.round((n - item.min) / item.step) * item.step + item.min
                            end
                            item.value.Value = n
                        end
                    end
                })
                return result
            elseif item.kind == "dropdown" then
                if #item.choices == 0 then return end
                return group:AddDropdown(idx, {
                    Text = label, Values = item.choices,
                    Default = item.choices[math.clamp(item.value.Value, 1, #item.choices)],
                    Multi = false,
                    Callback = function(v)
                        for i, name in ipairs(item.choices) do
                            if name == v then item.value.Value = i; break end
                        end
                    end
                })
            elseif item.kind == "input" then
                return group:AddInput(idx, {
                    Text = label, Default = item.value.Text,
                    Placeholder = item.value.PlaceholderText,
                    Finished = true, Callback = function(v) item.value.Text = tostring(v) end
                })
            end
        end)
        if not ok then
            warn("[Mr H UI] Failed to mirror " .. label .. ": " .. tostring(result))
        elseif result and item.value and item.kind ~= "button" and item.kind ~= "label" then
            -- Sync updates from the native reanimation engine back to the new UI.
            local connection = item.value.Changed:Connect(function()
                if BRIDGE.library ~= library or BRIDGE.rendering then return end
                local target = (library.Options and library.Options[idx])
                    or (library.Toggles and library.Toggles[idx])
                if target and type(target.SetValue) == "function" then
                    local n = item.value.Value
                    if item.kind == "dropdown" then n = item.choices[n]
                    elseif item.kind == "input" then n = item.value.Text end
                    if target.Value ~= n then
                        pcall(function() target:SetValue(n) end)
                    end
                end
            end)
            table.insert(BRIDGE.syncConnections, connection)
        end
    end
    local function teardown(self)
        for _, connection in ipairs(self.syncConnections) do
            connection:Disconnect()
        end
        table.clear(self.syncConnections)
        local old = self.library
        self.library, self.window = nil, nil
        if old and type(old.Unload) == "function" then pcall(function() old:Unload() end) end
    end
    function BRIDGE:activatePage(page)
        for _, info in ipairs(self.pages) do
            local selected = info.page == page
            info.page.Visible = selected
            info.page.Interactable = selected
        end
    end
    local function render(self, style)
        local lib, err = fromRemote(style)
        if not lib then return false, err end
        local ok, result = pcall(function()
            self.rendering = true
            local window = lib:CreateWindow({
                Title = "Mr H Reanimate", Footer = "UI Changer",
                Center = true, AutoShow = true, Resizable = true,
                TabPadding = 8, MenuFadeTime = 0.2,
                ToggleKeybind = Enum.KeyCode.RightControl,
            })
            self.library, self.window = lib, window
            local settings = window:AddTab("UI Changer")
            local group = settings:AddLeftGroupbox("Interface")
            group:AddLabel("Select a UI. Reanimate settings are preserved.")
            group:AddDropdown("MrHUIStyle", {
                Text = "UI Style", Values = names, Default = names[style],
                Multi = false,
                Callback = function(value)
                    for i, name in ipairs(names) do
                        if value == name and i ~= self.style then
                            task.defer(function() self:SetStyle(i) end)
                            return
                        end
                    end
                end,
            })
            group:AddButton("Restore Original", function() self:SetStyle(1) end)
            group:AddLabel("Right Control: show/hide this menu.")
            local mainInfo = self.pages[1]
            if mainInfo then
                self:activatePage(mainInfo.page)
            end
            local usedNames = {}
            for index, page in ipairs(self.pages) do
                if #page.items > 0 then
                    local tabTitle = page.title
                    if usedNames[tabTitle] then tabTitle = tabTitle .. " " .. index end
                    usedNames[page.title] = true
                    local tab = window:AddTab(tabTitle)
                    local show = tab.Show or tab.ShowTab
                    if type(show) == "function" then
                        local function onShow(selfTab, ...)
                            BRIDGE:activatePage(page.page)
                            return show(selfTab, ...)
                        end
                        if tab.Show then tab.Show = onShow
                        else tab.ShowTab = onShow end
                    end
                    local left = tab:AddLeftGroupbox("Controls")
                    local right = tab:AddRightGroupbox("More Controls")
                    local count = 0
                    for _, item in ipairs(page.items) do
                        local control = if count % 2 == 0 then left else right
                        attach(control, item, lib)
                        count += 1
                    end
                end
            end
            self.rendering = false
        end)
        if not ok then
            self.rendering = false
            teardown(self)
            return false, tostring(result)
        end
        return true
    end
    function BRIDGE:SetStyle(style)
        style = tonumber(style) or 1
        if style ~= 1 and style ~= 2 and style ~= 3 then return false end
        if self.rendering then return false end
        if self.style == style and (style == 1 or self.library) then return true end
        -- Unload an existing alternate window before creating the next one.
        teardown(self)
        if style == 1 then
            self.style, saved.MrHUIStyle = 1, 1
            if self.selector and self.selector.Value ~= 1 then self.selector.Value = 1 end
            originalWindow.Visible = true
            return true
        end
        originalWindow.Visible = true
        local success, err = render(self, style)
        if success then
            self.style, saved.MrHUIStyle = style, style
            if self.selector and self.selector.Value ~= style then self.selector.Value = style end
            originalWindow.Visible = false
            return true
        end
        self.style, saved.MrHUIStyle = 1, 1
        if self.selector and self.selector.Value ~= 1 then self.selector.Value = 1 end
        originalWindow.Visible = true
        self.lastNotice = err
        warn("[Mr H UI] " .. tostring(err) .. " - restored Original.")
        return false
    end
    function BRIDGE:queueRefresh()
        if self.style == 1 or self.rendering or self.rebuilding then return end
        self.rebuilding = true
        task.delay(0.75, function()
            self.rebuilding = false
            if self.style > 1 then
                local choice = self.style
                -- Rebuild once after dynamic controls are refreshed.
                self.style = 1
                self:SetStyle(choice)
            end
        end)
    end
    function BRIDGE:Start()
        -- Never restore an alternate UI during engine startup. A previous
        -- incomplete library init could hide the only working window.
        -- Users can manually switch after Original finishes loading.
        self.style = 1
        saved.MrHUIStyle = 1
        if self.selector then self.selector.Value = 1 end
        originalWindow.Visible = true
        print("[Mr H UI] Original loaded. Select Obsidian or Linoria from UI Changer.")
    end
    local env = _G
    if type(getgenv) == "function" then
        local ok, result = pcall(getgenv)
        if ok and type(result) == "table" then env = result end
    end
    env.MrHUIBridge = BRIDGE
    return BRIDGE
end
