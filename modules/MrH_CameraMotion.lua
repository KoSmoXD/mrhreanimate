-- Mr H Camera Motion: webcam-driven R6 moveset.
-- Phone/computer camera processing happens in the browser; only joint angles
-- cross the temporary relay. No remote Lua is executed from the website.
local modules = {}
table.insert(modules, function()
    local m = {}
    m.ModuleType = "MOVESET"
    m.Name = "Camera Motion"
    m.InternalName = "MRH_CAMERA_MOTION"
    m.Description = "Track your real body with a webcam. Open Mr H Animations > Camera Motion, start capture and enter its 10-character pairing code."
    m.Assets = {}
    local base = "https://mrh-animation-web-production.up.railway.app/api/mocap/session/"
    local web = "https://mrh-animation-web-production.up.railway.app/#camera-motion"
    local http = game:GetService("HttpService")
    local motors = {}
    local pose = nil
    local updated = 0
    local pairing = ""
    local active = false
    local lifetime = 0
    local label = nil
    local direction = {
        head = 1, torso = 1, leftArm = 1, rightArm = 1,
        leftLeg = 1, rightLeg = 1,
    }
    local names = {
        ["Head"] = "head", ["Torso"] = "torso", ["UpperTorso"] = "torso",
        ["Left Arm"] = "leftArm", ["Right Arm"] = "rightArm",
        ["Left Leg"] = "leftLeg", ["Right Leg"] = "rightLeg",
        ["LeftUpperArm"] = "leftArm", ["RightUpperArm"] = "rightArm",
        ["LeftUpperLeg"] = "leftLeg", ["RightUpperLeg"] = "rightLeg",
    }
    local function status(message)
        if label and label.Parent then
            label.Text = tostring(message)
        end
    end
    local function sanitize(text)
        local code = tostring(text or ""):upper():gsub("%s", "")
        if #code ~= 10 or not code:match("^[A-HJ-NP-Z2-9]+$") then return nil end
        return code
    end
    local function readRemote(code)
        local url = base .. code .. "/pose"
        local requester = request or (syn and syn.request) or (http and http.request)
        if type(requester) == "function" then
            local ok, response = pcall(requester, {Url=url,Method="GET",Timeout=5})
            if ok and type(response) == "table" then
                local st = tonumber(response.StatusCode or response.Status)
                local body = response.Body or response.body
                if st == 200 and type(body) == "string" then return http:JSONDecode(body) end
                if st == 404 then return nil, "Code expired - start a new browser session" end
            end
        end
        local ok, body = pcall(function() return game:HttpGet(url, true) end)
        if ok and type(body) == "string" then return http:JSONDecode(body) end
        return nil, "Website not reachable from Roblox executor"
    end
    local function valid(data)
        if type(data) ~= "table" then return false end
        for _, part in ipairs({"head","torso","leftArm","rightArm","leftLeg","rightLeg"}) do
            local value = data[part]
            if type(value) ~= "table" then return false end
            for i=1,3 do
                if type(value[i]) ~= "number" or value[i] ~= value[i]
                    or math.abs(value[i]) > 2.8 then return false end
            end
        end
        return true
    end
    local function begin()
        lifetime += 1
        local own = lifetime
        task.spawn(function()
            while active and own == lifetime do
                if pairing ~= "" then
                    local code = pairing
                    local done = false
                    -- Do not issue an unbounded number of stuck HTTP requests.
                    task.spawn(function()
                        local ok, result, reason = pcall(readRemote, code)
                        if active and own == lifetime and code == pairing then
                            if ok and type(result) == "table" and result.active
                                and valid(result.pose) then
                                pose = result.pose
                                updated = os.clock()
                                status("Connected - tracking your live movements")
                            elseif ok and result and result.active == false then
                                pose = nil
                                status("Waiting for body pose from camera...")
                            else
                                pose = nil
                                status(ok and tostring(reason or "Waiting for camera...") or "Webcam connection error")
                            end
                        end
                        done = true
                    end)
                    local deadline = os.clock() + 7
                    while active and own == lifetime and not done and os.clock() < deadline do
                        task.wait(0.1)
                    end
                    if not done then
                        pose = nil
                        status("Webcam request timed out - retrying after reconnect")
                        -- Retire this polling worker; an executor may have hung
                        -- in the transport. Re-select the moveset to retry.
                        break
                    end
                end
                task.wait(0.22)
            end
        end)
    end
    m.Config = function(parent)
        Util_CreateText(parent, "Open "+web, 12, Enum.TextXAlignment.Left)
        Util_CreateText(parent, "On the website press Start Camera, then enter the displayed pairing code.", 12, Enum.TextXAlignment.Left)
        local entry = Util_CreateTextbox(parent, pairing, "10-character camera code", 14)
        label = Util_CreateText(parent, pairing == "" and "Not paired" or "Code configured", 12, Enum.TextXAlignment.Left)
        local button = Util_CreateButton(parent, "Connect Webcam", 18)
        button.Activated:Connect(function()
            local nextCode = sanitize(entry.Text)
            if not nextCode then
                status("Invalid pairing code. Use 10 capital letters/numbers.")
                return
            end
            pairing = nextCode
            pose = nil
            updated = 0
            status("Connecting to live camera...")
        end)
    end
    m.Init = function(figure)
        active = true
        motors = {}
        pose = nil
        updated = 0
        if figure then
            for _, joint in ipairs(figure:GetDescendants()) do
                if joint:IsA("Motor6D") and joint.Part1 then
                    local part = names[joint.Part1.Name]
                    if part and not motors[part] then
                        motors[part] = joint
                    end
                end
            end
        end
        begin()
    end
    m.Update = function(dt, figure)
        if not active or not figure or figure:GetAttribute("IsDancing") then return end
        local usable = pose and updated > 0 and os.clock() - updated < 2
        local blend = math.clamp((tonumber(dt) or 0)*12, 0, 1)
        for part, motor in pairs(motors) do
            if motor and motor.Parent then
                local values = usable and pose[part] or nil
                local target = values and CFrame.Angles(
                    values[1]*direction[part], values[2], values[3]*direction[part]
                ) or CFrame.identity
                motor.Transform = motor.Transform:Lerp(target, blend)
            end
        end
    end
    m.Destroy = function()
        active = false
        lifetime += 1
        pose = nil
        updated = 0
        for _, joint in pairs(motors) do
            if joint and joint.Parent then
                pcall(function() joint.Transform = CFrame.identity end)
            end
        end
        table.clear(motors)
    end
    return m
end)
return modules
