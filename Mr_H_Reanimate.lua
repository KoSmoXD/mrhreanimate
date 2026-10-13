--[[
 Mr H Reanimate 2.3.0
 A maintained runtime fork/patch layer for UhhhhhhModded, not a repackaged source dump.
 Original engine: STEVETHEREALONE, BoredGal, Awes955 Modded.
 Upstream: https://github.com/testing734/UhhhhhhModded
 This file downloads a pinned copy of the original and modifies a short allowlist of
 source-level defects BEFORE compiling it. It does not distribute the original file.

 IMPORTANT: Executor-only. Not a Roblox Studio LocalScript. Roblox filtering and
 network ownership still determine what other clients can see.
]]

local BRAND = "Mr H Reanimate"
local VERSION = "2.3.0"
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
        -- Hot-update: remove v2.0's companion HUD without reinjecting engine hooks.
        if type(previous.shutdownHUD) == "function" then
            pcall(previous.shutdownHUD)
        elseif previous.gui then
            pcall(function() previous.gui:Destroy() end)
        end
        warn("[Mr H] Engine already running. Legacy HUD removed where present; rejoin for new intro.")
        return
    end
end

local state = {
    version = VERSION,
    baseCommit = BASE_COMMIT,
    status = "loading",
    errors = {},
    patches = {},
}

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

local function replaceSection(source, first, last, replacement, label)
    local startAt = source:find(first, 1, true)
    if not startAt or source:find(first, startAt + #first, true) then
        error("Section '" .. label .. "' needs exactly one start anchor.")
    end
    local endAt = source:find(last, startAt + #first, true)
    if not endAt or source:find(last, endAt + #last, true) then
        error("Section '" .. label .. "' needs exactly one end anchor.")
    end
    state.patches[#state.patches + 1] = label
    return source:sub(1, startAt - 1) .. replacement .. source:sub(endAt + #last)
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
        'local CracktroFrameText = "Mr H Reanimate"',
        "splash branding")
    source = patch(source,
        'TopBarText.Text = "Uhhhhhh Reanimate (modded by awes955) | v" .. UhhhhhhVersion',
        'TopBarText.Text = "Mr H Reanimate"',
        "topbar branding")
    source = patch(source,
        'UI.CreateText(MainPage, `Reanimate V{UhhhhhhVersion}, By STEVE :D and modded by awes`, 11, Enum.TextXAlignment.Right)',
        '-- Mr H: menu credit text removed; original authors acknowledged in source and README',
        "main-page branding and credits")

    source = patch(source,
        'stevetherealone.Text = "STEVE\\nTHERE\\nALONE"',
        'stevetherealone.Text = "tplay\\naddon\\nreal"',
        "original intro title")
    source = replaceSection(source,
        "\tlocal scrolltexts = {",
        "\tscrolltexts = scrolltexts[math.random(1, #scrolltexts)]",
        "\tlocal scrolltexts = \"LEGIT HEAVEN FOR REANIMATORS\"",
        "intro scrolling phrase")
    source = replaceSection(source,
        "\tif (SaveData.SkipIntro and math.random(2) == 1) or os.date(\"%m %d\") ~= \"04 01\" then",
        "\n\tlocal TopBarClose = Util.Instance(\"TextButton\", TopBarFrame)",
        "\tTopBarText.Text = \"Mr H Reanimate\"\n\tlocal TopBarClose = Util.Instance(\"TextButton\", TopBarFrame)",
        "static startup topbar")

    -- Experimental Hats Permadeath: legacy signal attempt, not a confirmed FE bypass.
    source = patch(source,
        [==[HatReanimator.Permadeath = false--not SaveData.Reanimator.HatsPatchmahub]==],
        [==[-- Experimental local hold: no removed Roblox death signal is required.
HatReanimator.Permadeath = SaveData.Reanimator.MrHExperimentalPermadeath == true]==],
        "experimental saved setting and supported-executor gate")
    source = patch(source,
        [==[UI.CreateText(parent, "permadeath is patched, enable this switch if you want to", 10, Enum.TextXAlignment.Center)
	UI.CreateSwitch(parent, "Permadeath", HatReanimator.Permadeath).Changed:Connect(function(val)
		HatReanimator.Permadeath = val
		SaveData.Reanimator.HatsPatchmahub = not val
	end)]==],
        [==[UI.CreateText(parent, "EXPERIMENTAL LOCAL HOLD: retain original Humanoid instead of killing it. Local-only and NOT real FE permadeath. Keep Hat Collide OFF; rejoin if stuck.", 10, Enum.TextXAlignment.Center)
	local permaSwitch = UI.CreateSwitch(parent, "Experimental Permadeath (Local Hold)", HatReanimator.Permadeath)
	permaSwitch.Changed:Connect(function(val)
		HatReanimator.Permadeath = val
		SaveData.Reanimator.MrHExperimentalPermadeath = val
		HatReanimator.Status.Permadeath = val and "Local hold selected; start/restart Hats reanimation" or "Disabled"
	end)]==],
        "experimental UI / graceful unsupported fallback")
    source = patch(source,
        [==[		HatReanimator.HasPermadeath, HatReanimator.HasHatCollide = perma, hatcols
		local hatcolmeth = HatReanimator.HatCollideMethod
		if not replicatesignal then perma = false end]==],
        [==[		-- Keeping the original body alive is incompatible with methods
		-- that wait for the server to delete the torso/head.
		if perma then hatcols = false end
		HatReanimator.HasHatCollide = hatcols
		local hatcolmeth = HatReanimator.HatCollideMethod
		if not hatcols then hatcolmeth = -1 end
		HatReanimator.HasPermadeath = perma]==],
        "perma mode flag reflects actual support")
    source = patch(source,
        [==[		local cdsbeffect = os.clock()
		local cdsbtime = os.clock()
		if perma then
			--replicatesignal(Player.ConnectDiedSignalBackend)
			HatReanimator.Status.Permadeath = "Fired CDSB Signal."
			cdsbeffect += Players.RespawnTime
		end]==],
        [==[		-- Removed ConnectDiedSignalBackend is not called. The local hold
		-- is implemented where upstream normally kills the Humanoid.
		if perma then
			HatReanimator.Status.Permadeath = "Local hold preparing; FE NOT VERIFIED"
		end]==],
        "attempt legacy death signal with protected call and fallback")
    source = patch(source,
        [==[		if perma then
			HatReanimator.Status.Permadeath = "no."
		else
			HatReanimator.Status.Permadeath = "Disabled, nothing to do."
		end]==],
        [==[		if perma then
			if not character:IsDescendantOf(workspace) or Humanoid.Health <= 0 then
				HatReanimator.Status.Permadeath = "Local hold lost: possible death/respawn"
				HatReanimator.HasPermadeath = false
			else
				HatReanimator.Status.Permadeath = "Local hold active on client; FE NOT VERIFIED"
			end
		elseif HatReanimator.Status.Permadeath == "Respawn detected." then
			HatReanimator.Status.Permadeath = "Normal Hats mode"
		end]==],
        "preserve truthful legacy status")
    -- Additional guarded changes for experimental local-only character hold.
    source = patch(source,
        [==[		if not perma then
			RootPosition += Vector3.new(0, 12, 0)]==],
        [==[		-- Keep the living original root above the destruction height.
		if perma then RootPosition += Vector3.new(0, 12, 0) end
		if not perma then
			RootPosition += Vector3.new(0, 12, 0)]==],
        "root safely above destroy height")
    source = patch(source,
        [==[		AvatarEditorService:BustAvatarFetchCache()
		pcall(replicatesignal, Humanoid.ServerBreakJoints)
		Humanoid.EvaluateStateMachine = true
		Humanoid.BreakJointsOnDeath = true
		Humanoid.Health = 0
		Humanoid:SetStateEnabled(Enum.HumanoidStateType.Dead, true)
		Humanoid:ChangeState(Enum.HumanoidStateType.Dead)
		readystate = 3]==],
        [==[		if perma then
			-- Experimental: do not deliberately kill the original Humanoid.
			-- Roblox can take physics ownership away when a Humanoid dies.
			local held, reason = pcall(function()
				Humanoid.BreakJointsOnDeath = false
				Humanoid:SetStateEnabled(Enum.HumanoidStateType.Dead, false)
				Humanoid.EvaluateStateMachine = false
				Humanoid:ChangeState(Enum.HumanoidStateType.Physics)
			end)
			if held then
				HatReanimator.Status.Permadeath = "Local hold attempted; FE NOT VERIFIED"
			else
				perma = false
				HatReanimator.HasPermadeath = false
				HatReanimator.Permadeath = false
				SaveData.Reanimator.MrHExperimentalPermadeath = false
				HatReanimator.Status.Permadeath = "Local hold failed: " .. tostring(reason)
			end
		end
		if not perma then
			AvatarEditorService:BustAvatarFetchCache()
			pcall(replicatesignal, Humanoid.ServerBreakJoints)
			Humanoid.EvaluateStateMachine = true
			Humanoid.BreakJointsOnDeath = true
			Humanoid.Health = 0
			Humanoid:SetStateEnabled(Enum.HumanoidStateType.Dead, true)
			Humanoid:ChangeState(Enum.HumanoidStateType.Dead)
		end
		readystate = 3]==],
        "nonlethal character-hold branch")
    source = patch(source,
        [==[					if (ReanimOkay and ReanimCharacter) or not HatReanimator.Permadeath then
						Camera.CameraSubject = ReanimCharacter:FindFirstChildOfClass("Humanoid")
					else
						Camera.CameraSubject = Humanoid
					end]==],
        [==[					if ReanimCharacter and (ReanimOkay or HatReanimator.Permadeath) then
						Camera.CameraSubject = ReanimCharacter:FindFirstChildOfClass("Humanoid") or Humanoid
					else
						Camera.CameraSubject = Humanoid
					end]==],
        "camera fallback follows the fake rig")
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

-- No companion HUD. Upstream reanimation controls are retained.

