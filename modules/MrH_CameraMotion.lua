-- Camera Motion v3 for Mr H Reanimate (Uhhhhhh MOVESET interface).
-- Protocol v2 3x3 matrices are conjugated into each Motor6D's live C0:
--   Transform = C0.Rotation^-1 * desiredRotation * C0.Rotation
-- Optional local Python protocol v2 from the user's r6_tracker.py.
-- Never runs arbitrary Lua or downloads another executable.
local modules = {}
table.insert(modules, function()
    local m = {}
    m.ModuleType = "MOVESET"
    m.Name = "Camera Motion"
    m.InternalName = "MRH_CAMERA_MOTION_V3"
    m.Description = "Live R6 body tracking: use the Mr H website pairing code or the Python v2 tracker."
    m.Assets = {}
    local WEBSITE = "https://mrh-animation-web-production.up.railway.app"
    local LEGACY_KEYS = {"head","torso","leftArm","rightArm","leftLeg","rightLeg"}
    local KEYS = {"neck","sh_l","sh_r","hip_l","hip_r","root"}
    local MAP = {
        ["Neck"]={key="neck",group="Head"},
        ["Left Shoulder"]={key="sh_l",mirror="sh_r",group="Arms"},
        ["Right Shoulder"]={key="sh_r",mirror="sh_l",group="Arms"},
        ["Left Hip"]={key="hip_l",mirror="hip_r",group="Legs"},
        ["Right Hip"]={key="hip_r",mirror="hip_l",group="Legs"},
        ["RootJoint"]={key="root",group="Torso"}
    }
    local cfg = {
        Mode = 1, Code = "", LocalUrl = "http://127.0.0.1:8080/pose",
        Smoothing = 0.35, Scale = 1,
        Head = true, Arms = true, Legs = true, Torso = true,
        Mirror = false, RootMotion = false
    }
    local httpService = nil
    local running = false
    local generation = 0
    local latest = nil
    local updatedAt = 0
    local joints = {}
    local statusLabel = nil
    local lastError = ""
    local moveOrigin = nil
    local moveLast = 0
    local connectionAttempt = 0
    local socket = nil
    local function status(value)
        local message = tostring(value)
        if statusLabel and statusLabel.Parent then statusLabel.Text = message end
        if message ~= lastError then
            print("[Camera Motion] " .. message)
            lastError = message
        end
    end
    local function codeValue(value)
        local code = tostring(value or ""):upper():gsub("%s","")
        if #code==10 and code:match("^[A-HJ-NP-Z2-9]+$") then return code end
        return nil
    end
    local function localUrl(value)
        local url=tostring(value or "")
        -- Never request an arbitrary internet URL from the executor in Python mode.
        if #url>130 or not url:match("^http://[%d%.]+:%d+/pose$") then return nil end
        local host=url:match("^http://([^:]+):")
        if host~="127.0.0.1" and host~="0.0.0.0" and not host:match("^192%.168%.")
           and not host:match("^10%.") and not host:match("^172%.1[6-9]%.")
           and not host:match("^172%.2%d%.") and not host:match("^172%.3[01]%.") then return nil end
        return url
    end
    local function validMatrix(v)
        if type(v)~="table" or #v~=9 then return false end
        for i=1,9 do
            local x=v[i]
            if type(x)~="number" or x~=x or math.abs(x)>1.01 then return false end
        end
        return true
    end
    local function validPose(data)
        if type(data)~="table" then return false end
        if data.v==2 then
            for _,name in ipairs(KEYS) do if not validMatrix(data[name]) then return false end end
            return true
        end
        for _,name in ipairs(LEGACY_KEYS) do
            local val=data[name]
            if type(val)~="table" or #val~=3 then return false end
            for i=1,3 do
                if type(val[i])~="number" or val[i]~=val[i] or math.abs(val[i])>2.8 then return false end
            end
        end
        return true
    end
    local function decodeResponse(value)
        if not httpService then httpService=game:GetService("HttpService") end
        local body
        if type(value)=="string" then body=value
        elseif type(value)=="table" then
            local st=tonumber(value.StatusCode or value.Status or value.status_code)
            if st and st~=200 then return nil, "HTTP "..st end
            body=value.Body or value.body
        end
        if type(body)~="string" or #body<5 or #body>40000 then return nil,"Empty response" end
        local ok,result=pcall(function() return httpService:JSONDecode(body) end)
        if ok and type(result)=="table" then return result end
        return nil,"JSON parse error"
    end
    -- Executor request() and game:HttpGet() can hang without returning.
    -- Put explicit deadlines on both methods so a broken transport reports
    -- a useful error instead of displaying Connecting forever.
    local function timedCall(label, seconds, callback)
        local done, ok, result = false, false, nil
        task.spawn(function()
            ok, result = pcall(callback)
            done = true
        end)
        local deadline = os.clock() + seconds
        while not done and os.clock() < deadline do
            task.wait(0.08)
        end
        if not done then return nil, label .. " timed out" end
        if not ok then return nil, label .. ": " .. tostring(result):sub(1,90) end
        return result
    end
    local function fetch(sourceUrl)
        -- Avoid local HttpService shadowing the executor's global http.request.
        local requester = request or http_request or (syn and syn.request)
            or (fluxus and fluxus.request) or (http and http.request)
        local errors = {}
        if type(requester) == "function" then
            local response, reason = timedCall("Executor HTTP", 5, function()
                return requester({Url=sourceUrl,Method="GET",Timeout=5})
            end)
            if response then
                local data, why = decodeResponse(response)
                if data then return data end
                table.insert(errors, tostring(why))
                if why == "HTTP 404" then
                    return nil, "Pairing code not found. Restart capture for a new code."
                end
            else
                table.insert(errors, tostring(reason))
            end
        end
        local body, reason = timedCall("Roblox HttpGet", 5, function()
            return game:HttpGet(sourceUrl, true)
        end)
        if body then
            local data, why = decodeResponse(body)
            if data then return data end
            table.insert(errors, tostring(why))
        else
            table.insert(errors, tostring(reason))
        end
        return nil, table.concat(errors, " | "):sub(1,165)
    end
    local function endpoint()
        if cfg.Mode==2 then return localUrl(cfg.LocalUrl) end
        local code=codeValue(cfg.Code)
        return code and (WEBSITE.."/api/mocap/session/"..code.."/pose") or nil
    end
    local function readOnce()
        local url=endpoint()
        if not url then return nil,"Enter a valid pairing code or LAN tracker URL" end
        local data,err=fetch(url)
        if not data then return nil,err end
        if cfg.Mode==2 then
            if data.v==2 and data.tracking==true and validPose(data) then return data end
            return nil,"Python tracker not reporting a valid v2 pose"
        end
        if data.active and validPose(data.pose) then return data.pose end
        if data.active==false then return nil,"Waiting for body detection" end
        return nil,"Invalid or expired camera session"
    end
    local function captureJoints(figure)
        table.clear(joints)
        if not figure then return end
        if not figure:FindFirstChild("Torso") then
            status("This moveset needs an R6 rig with a Torso")
            return
        end
        for _,joint in ipairs(figure:GetDescendants()) do
            if joint:IsA("Motor6D") and MAP[joint.Name] and joint.Part0 and joint.Part1 then
                joints[joint.Name]={motor=joint,c0=joint.C0.Rotation,info=MAP[joint.Name]}
            end
        end
        status("R6 joints found: "..tostring((function()
            local n=0 for _ in pairs(joints) do n+=1 end return n
        end)()))
    end
    local function rotation(mat)
        return CFrame.new(0,0,0,
            mat[1],mat[2],mat[3],mat[4],mat[5],mat[6],mat[7],mat[8],mat[9])
    end
    local function applyRoot(figure,source)
        if not cfg.RootMotion or cfg.Mode~=2 or not source or source.v~=2 then return end
        if type(source.strafe)~="number" or type(source.adv)~="number" then return end
        if os.clock()-updatedAt>.65 or os.clock()-moveLast<.3 then return end
        local humanoid=figure:FindFirstChildOfClass("Humanoid")
        local root=figure:FindFirstChild("HumanoidRootPart")
        local cam=workspace.CurrentCamera
        if not humanoid or not root or not cam then return end
        local fw=Vector3.new(cam.CFrame.LookVector.X,0,cam.CFrame.LookVector.Z)
        local right=Vector3.new(cam.CFrame.RightVector.X,0,cam.CFrame.RightVector.Z)
        if fw.Magnitude<.01 or right.Magnitude<.01 then return end
        moveOrigin=moveOrigin or root.Position
        local offset=(right.Unit*math.clamp(source.strafe,-2,2)
            +fw.Unit*math.clamp(source.adv,-2,2))*3
        if offset.Magnitude>.6 then pcall(function() humanoid:MoveTo(moveOrigin+offset) end) end
        moveLast=os.clock()
    end
    local poll
    local function releaseSocket()
        local previous=socket
        socket=nil
        if previous then
            pcall(function() previous:Close() end)
        end
    end
    local function openStream(own)
        local interface = WebSocket or websocket or (syn and syn.websocket)
        local connect = interface and (interface.connect or interface.Connect)
        if type(connect)~="function" then
            return false, "Executor has no WebSocket support"
        end
        local code=codeValue(cfg.Code)
        if not code then return false, "Invalid pairing code" end
        local url="wss://mrh-animation-web-production.up.railway.app/api/mocap/ws/"..code
        local client,why=timedCall("WebSocket",6,function() return connect(url) end)
        if not client then return false,tostring(why) end
        if generation~=own then
            pcall(function() client:Close() end)
            return false,"Connection cancelled"
        end
        local ok=pcall(function()
            client.OnMessage:Connect(function(message)
                if generation~=own or socket~=client then return end
                local result=decodeResponse(message)
                if not result then return end
                if result.active and validPose(result.pose) then
                    latest=result.pose
                    updatedAt=os.clock()
                    status("Live camera connected via WebSocket (v"..tostring(latest.v or 1)..")")
                elseif result.type=="connected" then
                    status("WebSocket paired - waiting for camera movement")
                end
            end)
            client.OnClose:Connect(function()
                if generation~=own or socket~=client then return end
                socket=nil
                latest=nil
                status("WebSocket disconnected. Reconnecting...")
                if running then
                    task.delay(1,function()
                        if generation==own and running then poll() end
                    end)
                end
            end)
        end)
        if not ok then
            pcall(function() client:Close() end)
            return false,"Executor WebSocket event API unsupported"
        end
        socket=client
        status("WebSocket connected. Waiting for live camera frames...")
        return true
    end
    poll = function()
        generation+=1
        local own=generation
        releaseSocket()
        task.spawn(function()
            if cfg.Mode==1 then
                local ok,why=openStream(own)
                if generation~=own then return end
                if ok then return end
                status("WebSocket unavailable: "..tostring(why):sub(1,85)..". Trying HTTP...")
            end
            if not endpoint() then
                status("Enter pairing code and press Connect Camera")
                return
            end
            repeat
                local ok,source,reason=pcall(readOnce)
                if generation~=own then return end
                if ok and source and validPose(source) then
                    latest=source
                    updatedAt=os.clock()
                    status("Live camera connected via HTTP (v"..tostring(source.v or 1)..")")
                else
                    latest=nil
                    local errorMessage=ok and tostring(reason or "Waiting for camera")
                        or "Pose request failed"
                    if errorMessage:find("timed out",1,true) then
                        status("All camera transports unavailable. Executor may block this domain: "..errorMessage:sub(1,90))
                    else
                        status("Camera: "..errorMessage:sub(1,155))
                    end
                end
                if not running then break end
                task.wait(.7)
            until generation~=own
        end)
    end
    m.Config=function(parent)
        Util_CreateText(parent,"Camera Motion v3: accurate R6 matrices",17,Enum.TextXAlignment.Center)
        Util_CreateText(parent,"Browser: "..WEBSITE.."/#camera-motion",11,Enum.TextXAlignment.Left)
        Util_CreateText(parent,"Press Use Moveset at the TOP to equip, then connect. Reanimation must be active.",12,Enum.TextXAlignment.Left)
        local mode=Util_CreateDropdown(parent,"Capture Source",{"Website Pairing","Local Python v2"},cfg.Mode)
        mode.Changed:Connect(function(v)
            cfg.Mode=v
            latest=nil
            status(v==2 and "Python: enter LAN pose URL" or "Website: enter pairing code")
        end)
        local codeBox=Util_CreateTextbox(parent,cfg.Code,"10-character pairing code",14)
        local urlBox=Util_CreateTextbox(parent,cfg.LocalUrl,"Python URL (http://127.0.0.1:8080/pose)",14)
        local connect=Util_CreateButton(parent,"Connect Camera",17)
        statusLabel=Util_CreateText(parent,"Not connected",12,Enum.TextXAlignment.Left)
        connect.Activated:Connect(function()
            if cfg.Mode==2 then
                local url=localUrl(urlBox.Text)
                if not url then status("Invalid private LAN tracker URL");return end
                cfg.LocalUrl=url
            else
                local code=codeValue(codeBox.Text)
                if not code then status("Enter the 10-character camera pairing code");return end
                cfg.Code=code
            end
            latest=nil
            updatedAt=0
            connectionAttempt += 1
            status("Connecting via WebSocket first, then HTTP fallback...")
            poll()
        end)
        local test=Util_CreateButton(parent,"Test Connection",14)
        test.Activated:Connect(function()
            status("Testing live camera transports...")
            poll()
        end)
        Util_CreateSlider(parent,"Pose Smoothing",cfg.Smoothing,.05,1,.05)
            .Changed:Connect(function(v) cfg.Smoothing=v end)
        Util_CreateSlider(parent,"Rotation Scale",cfg.Scale,.1,2,.1)
            .Changed:Connect(function(v) cfg.Scale=v end)
        Util_CreateSwitch(parent,"Track Head",cfg.Head).Changed:Connect(function(v) cfg.Head=v end)
        Util_CreateSwitch(parent,"Track Arms",cfg.Arms).Changed:Connect(function(v) cfg.Arms=v end)
        Util_CreateSwitch(parent,"Track Legs",cfg.Legs).Changed:Connect(function(v) cfg.Legs=v end)
        Util_CreateSwitch(parent,"Track Torso",cfg.Torso).Changed:Connect(function(v) cfg.Torso=v end)
        Util_CreateSwitch(parent,"Mirror",cfg.Mirror).Changed:Connect(function(v) cfg.Mirror=v end)
        Util_CreateSwitch(parent,"Python Root Movement (experimental)",cfg.RootMotion)
            .Changed:Connect(function(v) cfg.RootMotion=v end)
    end
    m.SaveConfig=function() return cfg end
    m.LoadConfig=function(data)
        if type(data)~="table" then return end
        for k,v in pairs(data) do
            if cfg[k]~=nil and type(v)==type(cfg[k]) then cfg[k]=v end
        end
    end
    m.Init=function(figure)
        running=true
        status("Camera Motion equipped. Polling starts now.")
        latest=nil
        updatedAt=0
        moveOrigin=nil
        moveLast=0
        captureJoints(figure)
        poll()
    end
    m.Update=function(dt,figure)
        if not running or not figure or figure:GetAttribute("IsDancing") then return end
        local fresh=latest and os.clock()-updatedAt<.65
        local blend=math.clamp(1-(1-cfg.Smoothing)^math.clamp((tonumber(dt) or 0)*60,0,5),0,1)
        local v=fresh and latest or nil
        local legacy={["Neck"]="head",["RootJoint"]="torso",["Left Shoulder"]="leftArm",
            ["Right Shoulder"]="rightArm",["Left Hip"]="leftLeg",["Right Hip"]="rightLeg"}
        for name,entry in pairs(joints) do
            local motor=entry.motor
            local info=entry.info
            if motor and motor.Parent then
                local enabled=cfg[info.group]~=false
                local target=CFrame.identity
                if v and enabled then
                    if v.v==2 then
                        local key=cfg.Mirror and info.mirror or nil
                        local mt=v[key or info.key]
                        if validMatrix(mt) then
                            local desired=rotation(mt)
                            if cfg.Scale~=1 then
                                local axis,angle=desired:ToAxisAngle()
                                desired=CFrame.fromAxisAngle(axis,angle*cfg.Scale)
                            end
                            target=entry.c0:Inverse()*desired*entry.c0
                        end
                    else
                        local angles=v[legacy[name]]
                        if angles then
                            target=CFrame.Angles(angles[1]*cfg.Scale,angles[2],angles[3]*cfg.Scale)
                        end
                    end
                end
                motor.Transform=motor.Transform:Lerp(target,blend)
            end
        end
        if v then applyRoot(figure,v) end
    end
    m.Destroy=function()
        running=false
        connectionAttempt += 1
        generation+=1
        releaseSocket()
        latest=nil
        moveOrigin=nil
        for _,entry in pairs(joints) do
            if entry.motor and entry.motor.Parent then
                pcall(function() entry.motor.Transform=CFrame.identity end)
            end
        end
        table.clear(joints)
    end
    return m
end)
return modules
