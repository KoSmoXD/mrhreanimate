--[[
 Mr H Reanimate 2.0.0
 A maintained runtime fork/patch layer for UhhhhhhModded, not a repackaged source dump.
 Original engine: STEVETHEREALONE, BoredGal, Awes955 Modded.
 Upstream: https://github.com/testing734/UhhhhhhModded
 This file downloads a pinned copy of the original and modifies a short allowlist of
 source-level defects BEFORE compiling it. It does not distribute the original file.

 IMPORTANT: Executor-only. Not a Roblox Studio LocalScript. Roblox filtering and
 network ownership still determine what other clients can see.
]]

local BRAND = "Mr H Reanimate"
local VERSION = "2.0.0"
local BASE_COMMIT = "87467966d37ce4b8b2c219a0bcffaf2aa8f658a9"
local BASE_URL = "https://raw.githubusercontent.com/testing734/UhhhhhhModded/"
    .. BASE_COMMIT .. "/uhhhhhh%20awes%20fork"

local env = _G
if type(getgenv) == "function" then
    local ok, result = pcall(getgenv)
    if ok and type(result) == "table" then env = result end
end

if type(env.MrHReanimate) == "table" then
    local previous = env.MrHReanimate
    if previous.status == "running" or previous.status == "loading" then
        if type(previous.show) == "function" then
            pcall(previous.show)
        elseif previous.status == "running" and type(previous.rebuildHUD) == "function" then
            pcall(previous.rebuildHUD)
        end
        warn("[Mr H] Already running; reusing active instance.")
        return
    end
end

local state = {
    version = VERSION,
    baseCommit = BASE_COMMIT,
    status = "loading",
    errors = {},
    patches = {},
    settings = { fullbright = false, nofog = false, shadows = false, rigHighlight = false },
    connections = {},
    restore = {},
    gui = nil,
    highlight = nil,
    show = nil,
    shutdownHUD = nil,
}
env.MrHReanimate = state

local function note(msg)
    warn("[Mr H] " .. tostring(msg))
end

local function fail(msg)
    state.status = "failed"
    state.errors[#state.errors + 1] = tostring(msg)
    note(msg)
end

local function fetchPinned()
    local attempts = {}
    local requester = request or (syn and syn.request) or (http and http.request)
    for attempt = 1, 3 do
        if type(requester) == "function" then
            local ok, response = pcall(requester, { Url = BASE_URL, Method = "GET" })
            if ok and type(response) == "table" then
                local body = response.Body or response.body
                local status = tonumber(response.StatusCode or response.Status or response.status_code)
                if status == 200 and type(body) == "string" and #body > 150000 then
                    return body
                end
                attempts[#attempts + 1] = "request HTTP " .. tostring(status)
            else
                attempts[#attempts + 1] = "request failed: " .. tostring(response)
            end
        end
        local hasHttpGet, httpGet = pcall(function() return game.HttpGet end)
        if hasHttpGet and type(httpGet) == "function" then
            local ok, body = pcall(function() return game:HttpGet(BASE_URL) end)
            if ok and type(body) == "string" and #body > 150000 then
                return body
            end
            attempts[#attempts + 1] = "HttpGet failed: " .. tostring(body)
        end
        if attempt < 3 then task.wait(1) end
    end
    error("Could not fetch pinned engine. " .. table.concat(attempts, " | "))
end

local function escapePattern(str)
    return (str:gsub("([^%w])", "%%%1"))
end

-- Changes are exact-match, counted, and fail closed if upstream shape changes.
local function patch(source, old, new, label)
    local updated, n = source:gsub(escapePattern(old), function() return new end)
    if n ~= 1 then
        error("Patch '" .. label .. "' expected once, found " .. tostring(n)
            .. ". Engine NOT executed. This version needs review.")
    end
    state.patches[#state.patches + 1] = label
    return updated
end

local function rewrite(source)
    source = source:gsub("\r\n", "\n"):gsub("\r", "\n")
    if #source < 150000 or #source > 1000000 then
        error("Unexpected engine size: " .. tostring(#source))
    end
    source = patch(source,
        "local Debris = cloneref(game:GetService(\"Debris\"))",
        "cloneref = cloneref or function(obj) return obj end\nlocal Debris = cloneref(game:GetService(\"Debris\"))",
        "cloneref boot order")
    source = patch(source,
        "local conn conn = RunService.PreRender:Connect(function()",
        "local conn = GuiService:GetPropertyChangedSignal(\"PreferredTextSize\"):Connect(function()",
        "text-size syntax and per-frame callback")
    -- In the third gethiddenproperty declaration, the original accidentally overwrites
    -- the getter rather than defining the setter. This exact block is unique.
    source = patch(source,
        "\t\t\tgethiddenproperty = function(inst, prop, val)\n"
          .. "\t\t\t\tlocal was = isscriptable(inst, prop)\n"
          .. "\t\t\t\tif not was then setscriptable(inst, prop, true) end\n"
          .. "\t\t\t\tinst[prop] = val\n",
        "\t\t\tsethiddenproperty = function(inst, prop, val)\n"
          .. "\t\t\t\tlocal was = isscriptable(inst, prop)\n"
          .. "\t\t\t\tif not was then setscriptable(inst, prop, true) end\n"
          .. "\t\t\t\tinst[prop] = val\n",
        "hidden-property fallback typo")
    source = patch(source,
        "while true do\n\t\t\ttask.wait()\n\t\t\tlocal s, data = pcall(HttpService.JSONEncode, HttpService, SaveData)",
        "while true do\n\t\t\ttask.wait(0.75)\n\t\t\tlocal s, data = pcall(HttpService.JSONEncode, HttpService, SaveData)",
        "throttled save-data polling")
    source = patch(source,
        "local plrstuff = playerGui:GetGuiObjectsAtPosition(pos.X, pos.Y)",
        "local plrstuff = playerGui and playerGui:GetGuiObjectsAtPosition(pos.X, pos.Y) or {}",
        "safe missing PlayerGui")
    -- The optional upstream tail contains random waits, local-file scanning,
    -- remote downloads and a WebSocket command channel that executes received Lua.
    -- Its only call is at EOF. It is not used by the reanimation engine.
    local unwantedTail = "\nlocal d = function()\n\t-- registry overflow bypass"
    local tailStart = source:find(unwantedTail, 1, true)
    if not tailStart or not source:find("if WebSocket and WebSocket.connect then", tailStart, true)
        or not source:find('if name == "jumpscare" then', tailStart, true)
        or not source:match("end d%(%)%s*$") then
        error("Unreviewed optional startup tail; refusing to run.")
    end
    source = source:sub(1, tailStart - 1)
       .. "\n-- Mr H: disabled unneeded legacy Easter egg / file scan / remote command channel.\n"
    state.patches[#state.patches + 1] = "remove untrusted optional background routine"
    source = patch(source,
        'Title = "Uhhhhhh",',
        'Title = "Mr H Reanimate",',
        "notification branding")
    source = patch(source,
        'local CracktroFrameText = "Uhhhhhh Reanimate (modded) V" .. UhhhhhhVersion',
        'local CracktroFrameText = "Mr H Reanimate | engine v" .. UhhhhhhVersion',
        "splash branding")
    source = patch(source,
        'TopBarText.Text = "Uhhhhhh Reanimate (modded by awes955) | v" .. UhhhhhhVersion',
        'TopBarText.Text = "Mr H Reanimate | engine v" .. UhhhhhhVersion',
        "topbar branding")
    source = patch(source,
        'TopBarText.Text = "Uhhhhhh ( mod ) | v" .. UhhhhhhVersion',
        'TopBarText.Text = "Mr H Reanimate | engine v" .. UhhhhhhVersion',
        "fallback topbar branding")
    source = patch(source,
        'UI.CreateText(MainPage, `Reanimate V{UhhhhhhVersion}, By STEVE :D and modded by awes`, 11, Enum.TextXAlignment.Right)',
        'UI.CreateText(MainPage, `Mr H Reanimate | Engine V{UhhhhhhVersion} | STEVE, BoredGal, Awes955`, 11, Enum.TextXAlignment.Right)',
        "main-page branding and credits")
    return source
end

if env.UhhhhhhLoaded or _G.UhhhhhhLoaded then
    fail("An upstream Uhhhhhh session is already active. Rejoin before launching Mr H to prevent duplicate engine hooks.")
    return
end

local fetched, base = pcall(fetchPinned)
if not fetched then
    fail(base)
    return
end
local rewritten, result = pcall(rewrite, base)
if not rewritten then
    fail(result)
    return
end

local compileOK, chunk, compileError = pcall(loadstring, result, "Mr_H_Reanimate_Engine")
if not compileOK or type(chunk) ~= "function" then
    fail("Compiler rejected patched engine: " .. tostring(compileError or chunk))
    return
end

-- Let source initialize naturally. Never forge an 'engine running' status.
local executed, err = pcall(chunk)
if not executed then
    env.UhhhhhhLoaded = nil
    _G.UhhhhhhLoaded = nil
    fail("Engine startup error: " .. tostring(err))
    return
end
state.status = "running"
note("Engine launched. " .. #state.patches .. " reviewed patches applied.")

-- Lightweight optional companion HUD. Fails independently of the engine.
local function createHUD()
    local Players = game:GetService("Players")
    local RunService = game:GetService("RunService")
    local UserInputService = game:GetService("UserInputService")
    local Lighting = game:GetService("Lighting")
    local CoreGui = game:GetService("CoreGui")
    local player = Players.LocalPlayer
    local camera = workspace.CurrentCamera
    local C = {
        bg = Color3.fromRGB(14, 17, 26),
        panel = Color3.fromRGB(23, 28, 42),
        accent = Color3.fromRGB(153, 119, 255),
        white = Color3.fromRGB(236, 239, 249),
        muted = Color3.fromRGB(157, 164, 182),
        green = Color3.fromRGB(127, 227, 171),
    }
    local gui = Instance.new("ScreenGui")
    gui.Name = "MrHReanimateHUD"
    gui.ResetOnSpawn = false
    gui.IgnoreGuiInset = false
    gui.DisplayOrder = 999999
    local parent
    if type(gethui) == "function" then
        local ok, root = pcall(gethui)
        if ok and typeof(root) == "Instance" then parent = root end
    end
    if not parent and type(get_hidden_gui) == "function" then
        local ok, root = pcall(get_hidden_gui)
        if ok and typeof(root) == "Instance" then parent = root end
    end
    parent = parent or CoreGui
    local attached = pcall(function() gui.Parent = parent end)
    if not attached then
        gui.Parent = player:WaitForChild("PlayerGui", 5)
    end
    state.gui = gui
    local function new(class, properties, holder)
        local inst = Instance.new(class)
        for key, value in pairs(properties) do inst[key] = value end
        inst.Parent = holder
        return inst
    end
    local function round(inst, r)
        new("UICorner", { CornerRadius = UDim.new(0, r) }, inst)
    end
    local function outline(inst, color)
        new("UIStroke", { Color = color or C.accent, Thickness = 1, Transparency = 0.42 }, inst)
    end
    local viewport = camera and camera.ViewportSize or Vector2.new(400, 800)
    local panelWidth = math.min(322, math.max(250, viewport.X - 28))
    local panelHeight = math.min(388, math.max(240, viewport.Y - 94))
    local panel = new("Frame", {
        Name = "ControlPanel", AnchorPoint = Vector2.new(1, 0),
        Position = UDim2.new(1, -12, 0, 14), Size = UDim2.fromOffset(panelWidth, panelHeight),
        BackgroundColor3 = C.bg, BorderSizePixel = 0,
    }, gui)
    round(panel, 13)
    outline(panel)
    local head = new("Frame", {
        Name = "Header", Size = UDim2.new(1, 0, 0, 55),
        BackgroundColor3 = C.panel, BorderSizePixel = 0, Active = true,
    }, panel)
    round(head, 13)
    new("TextLabel", {
        BackgroundTransparency = 1, Position = UDim2.fromOffset(14, 7),
        Size = UDim2.new(1, -60, 0, 23), Text = "MR H REANIMATE",
        TextColor3 = C.white, TextSize = 16, Font = Enum.Font.GothamBold,
        TextXAlignment = Enum.TextXAlignment.Left,
    }, head)
    new("TextLabel", {
        BackgroundTransparency = 1, Position = UDim2.fromOffset(14, 29),
        Size = UDim2.new(1, -40, 0, 18), Text = "v" .. VERSION .. " | patched upstream engine",
        TextColor3 = C.muted, TextSize = 10, Font = Enum.Font.Gotham,
        TextXAlignment = Enum.TextXAlignment.Left,
    }, head)
    local collapse = new("TextButton", {
        Position = UDim2.new(1, -42, 0, 12), Size = UDim2.fromOffset(29, 29),
        Text = "_", BackgroundColor3 = C.bg, TextColor3 = C.white,
        Font = Enum.Font.GothamBold, TextSize = 17, BorderSizePixel = 0,
    }, head)
    round(collapse, 8)
    local bubble = new("TextButton", {
        Name = "OpenMrH", Position = UDim2.new(1, -79, 0, 12),
        Size = UDim2.fromOffset(66, 42), Text = "MR H", Visible = false,
        BackgroundColor3 = C.accent, TextColor3 = C.bg,
        BorderSizePixel = 0, Font = Enum.Font.GothamBold, TextSize = 15,
    }, gui)
    round(bubble, 12)
    local function show()
        panel.Visible = true
        bubble.Visible = false
    end
    local function hide()
        panel.Visible = false
        bubble.Visible = true
    end
    state.show = show
    state.hide = hide
    state.connections[#state.connections+1] = collapse.Activated:Connect(hide)
    state.connections[#state.connections+1] = bubble.Activated:Connect(show)

    local scroll = new("ScrollingFrame", {
        BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 3,
        Position = UDim2.fromOffset(11, 62), Size = UDim2.new(1, -22, 1, -73),
        CanvasSize = UDim2.new(0, 0, 0, 0), AutomaticCanvasSize = Enum.AutomaticSize.Y,
    }, panel)
    new("UIListLayout", {
        Padding = UDim.new(0, 7), SortOrder = Enum.SortOrder.LayoutOrder,
    }, scroll)
    local counter = 0
    local function label(text, size, color, height)
        counter = counter + 1
        return new("TextLabel", {
            LayoutOrder = counter, Size = UDim2.new(1, -4, 0, height or 20),
            BackgroundTransparency = 1, Text = text, TextWrapped = true,
            TextColor3 = color or C.white, TextSize = size or 12,
            Font = Enum.Font.Gotham, TextXAlignment = Enum.TextXAlignment.Left,
        }, scroll)
    end
    local function button(title, click, enabled)
        counter = counter + 1
        local b = new("TextButton", {
            LayoutOrder = counter, Size = UDim2.new(1, -4, 0, 33),
            BackgroundColor3 = C.panel, BorderSizePixel = 0, Text = title,
            TextColor3 = C.white, Font = Enum.Font.GothamMedium, TextSize = 12,
            AutoButtonColor = true,
        }, scroll)
        round(b, 8)
        local active = false
        local function refresh()
            if enabled then
                b.BackgroundColor3 = active and C.accent or C.panel
                b.TextColor3 = active and C.bg or C.white
                b.Text = (active and "ON  •  " or "OFF •  ") .. title
            end
        end
        refresh()
        state.connections[#state.connections+1] = b.Activated:Connect(function()
            if enabled then active = not active end
            local ok, errorMessage = pcall(click, active)
            if not ok then
                if enabled then active = not active end
                note("HUD feature: " .. tostring(errorMessage))
            end
            refresh()
        end)
        return b
    end
    label("ENGINE STATUS", 12, C.accent, 20)
    local engineStatus = label("checking...", 12, C.green, 24)
    local bodyStatus = label("rig: scanning", 11, C.muted, 20)
    local fpsStatus = label("fps: measuring", 11, C.muted, 20)
    label("LOCAL VISUALS", 12, C.accent, 24)

    local lightingOriginal = {
        Brightness = Lighting.Brightness,
        Ambient = Lighting.Ambient,
        OutdoorAmbient = Lighting.OutdoorAmbient,
        ClockTime = Lighting.ClockTime,
        GlobalShadows = Lighting.GlobalShadows,
        FogEnd = Lighting.FogEnd,
    }
    local atmosphereValues = {}
    for _, item in ipairs(Lighting:GetChildren()) do
        if item:IsA("Atmosphere") then
            atmosphereValues[item] = { Density = item.Density, Haze = item.Haze, Glare = item.Glare }
        end
    end
    state.restore.lighting = function()
        for property, value in pairs(lightingOriginal) do
            pcall(function() Lighting[property] = value end)
        end
        for item, values in pairs(atmosphereValues) do
            if item.Parent then
                item.Density = values.Density
                item.Haze = values.Haze
                item.Glare = values.Glare
            end
        end
    end
    local function setLightProperty(key, value)
        pcall(function() Lighting[key] = value end)
    end
    button("Fullbright", function(on)
        state.settings.fullbright = on
        setLightProperty("Brightness", on and 3 or lightingOriginal.Brightness)
        setLightProperty("Ambient", on and Color3.new(1, 1, 1) or lightingOriginal.Ambient)
        setLightProperty("OutdoorAmbient", on and Color3.new(1, 1, 1) or lightingOriginal.OutdoorAmbient)
        setLightProperty("ClockTime", on and 14 or lightingOriginal.ClockTime)
    end, true)
    button("No fog", function(on)
        state.settings.nofog = on
        setLightProperty("FogEnd", on and 1000000 or lightingOriginal.FogEnd)
        for item, vals in pairs(atmosphereValues) do
            if item.Parent then
                item.Density = on and 0 or vals.Density
                item.Haze = on and 0 or vals.Haze
                item.Glare = on and 0 or vals.Glare
            end
        end
    end, true)
    button("FPS: reduce shadows", function(on)
        state.settings.shadows = on
        setLightProperty("GlobalShadows", on and false or lightingOriginal.GlobalShadows)
    end, true)
    local function clearHighlight()
        if state.highlight then
            state.highlight:Destroy()
            state.highlight = nil
        end
    end
    button("Outline my reanimated rig", function(on)
        state.settings.rigHighlight = on
        if not on then clearHighlight() end
    end, true)
    label("TOOLS", 12, C.accent, 23)
    button("Minimize Mr H panel", hide, false)
    button("Remove companion HUD (engine stays on)", function()
        if type(state.shutdownHUD) == "function" then state.shutdownHUD() end
    end, false)
    label("Rig replication depends on Roblox network ownership. The original engine UI remains accessible.", 10, C.muted, 38)

    local elapsed = 0
    local frames = 0
    local lastFps = 0
    local scanClock = 0
    local function update(dt)
        frames = frames + 1
        elapsed = elapsed + math.min(dt or 0, 0.2)
        if elapsed > 0.8 then
            lastFps = math.floor(frames / elapsed + 0.5)
            elapsed = 0
            frames = 0
            fpsStatus.Text = "fps: " .. tostring(lastFps)
        end
        scanClock = scanClock + math.min(dt or 0, 0.2)
        if scanClock < 0.65 then return end
        scanClock = 0
        local api = env.Uhhhhhh or _G.Uhhhhhh
        local rig = type(api) == "table" and api.Character or nil
        local valid = typeof(rig) == "Instance" and rig:IsA("Model") and rig.Parent ~= nil
        engineStatus.Text = valid and "reanimation: ACTIVE" or "engine: loaded / awaiting rig"
        if valid then
            local hum = rig:FindFirstChildOfClass("Humanoid")
            local rigType = hum and tostring(hum.RigType.Name) or "custom"
            bodyStatus.Text = "rig: " .. rigType .. " | " .. rig.Name
        else
            bodyStatus.Text = "rig: not detected"
        end
        if state.settings.rigHighlight then
            if valid then
                if not state.highlight or state.highlight.Adornee ~= rig then
                    clearHighlight()
                    local h = Instance.new("Highlight")
                    h.Name = "MrHLocalRigOutline"
                    h.Adornee = rig
                    h.FillTransparency = 1
                    h.OutlineTransparency = 0.1
                    h.OutlineColor = C.accent
                    h.DepthMode = Enum.HighlightDepthMode.Occluded
                    h.Parent = gui
                    state.highlight = h
                end
            else
                clearHighlight()
            end
        end
    end
    state.connections[#state.connections+1] = RunService.Heartbeat:Connect(update)
    state.shutdownHUD = function()
        for _, connection in ipairs(state.connections) do
            pcall(function() connection:Disconnect() end)
        end
        state.connections = {}
        clearHighlight()
        if state.restore.lighting then state.restore.lighting() end
        state.settings = {fullbright = false, nofog = false, shadows = false, rigHighlight = false}
        if state.gui then state.gui:Destroy() end
        state.gui = nil
        state.show = nil
        state.hide = nil
        state.shutdownHUD = nil
    end
    -- Keep panel accessible on smaller phone displays (no global camera spins).
    local dragging, dragStart, originalPos
    state.connections[#state.connections+1] = head.InputBegan:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1
            or input.UserInputType == Enum.UserInputType.Touch then
            dragging = true
            dragStart = input.Position
            originalPos = panel.Position
        end
    end)
    state.connections[#state.connections+1] = UserInputService.InputEnded:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1
            or input.UserInputType == Enum.UserInputType.Touch then dragging = false end
    end)
    state.connections[#state.connections+1] = UserInputService.InputChanged:Connect(function(input)
        if not dragging or not dragStart then return end
        if input.UserInputType ~= Enum.UserInputType.MouseMovement
            and input.UserInputType ~= Enum.UserInputType.Touch then return end
        local delta = input.Position - dragStart
        local size = workspace.CurrentCamera and workspace.CurrentCamera.ViewportSize or viewport
        local x = math.clamp(originalPos.X.Offset + delta.X, -size.X + panelWidth + 6, -6)
        local y = math.clamp(originalPos.Y.Offset + delta.Y, 0, math.max(0, size.Y - 60))
        panel.Position = UDim2.new(1, x, 0, y)
    end)
end

state.rebuildHUD = createHUD
local uiOK, uiError = pcall(createHUD)
if not uiOK then
    note("Engine running; optional HUD failed: " .. tostring(uiError))
end
