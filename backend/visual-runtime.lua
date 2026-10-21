-- Generated visuals are local cosmetic effects. Exact names apply to matching worn accessories.
local effects, originals, ownOverrides = {}, {}, {}
local currentFigure = nil
local function removeOverrides()
    if type(HatReanimator) == "table" and type(HatReanimator.HatCFrameOverride) == "table" then
        for i = #HatReanimator.HatCFrameOverride, 1, -1 do
            if ownOverrides[HatReanimator.HatCFrameOverride[i]] then table.remove(HatReanimator.HatCFrameOverride, i) end
        end
    end
    ownOverrides = {}
end
local function restoreBindings()
    removeOverrides()
    for _, saved in ipairs(originals) do
        if saved.part and saved.part.Parent then saved.part.LocalTransparencyModifier = saved.transparency end
        if saved.weld and saved.weld.Parent then
            saved.weld.Part1, saved.weld.C0, saved.weld.C1 = saved.part1, saved.c0, saved.c1
        end
    end
    originals = {}
end
local function destroy()
    restoreBindings()
    for _, entry in ipairs(effects) do
        for i = #entry.objects, 1, -1 do pcall(function() entry.objects[i]:Destroy() end) end
    end
    effects, currentFigure = {}, nil
end
local function active(rule, state, time)
    return state ~= nil and (rule.state == "all" or rule.state == state) and time >= rule.start and (rule["end"] == nil or time < rule["end"])
end
local function targets(figure, named)
    local found, seen = {}, {}
    local player = game:GetService("Players").LocalPlayer
    for _, model in ipairs({figure, player and player.Character or figure}) do
        if model then
            for _, accessory in ipairs(model:GetChildren()) do
                if accessory:IsA("Accessory") and accessory.Name == named then
                    local handle = accessory:FindFirstChild("Handle")
                    if handle and handle:IsA("BasePart") and not seen[handle] then
                        seen[handle] = true
                        table.insert(found, {part = handle, weld = handle:FindFirstChild("AccessoryWeld")})
                    end
                end
            end
        end
    end
    return found
end
local function color(hex)
    return Color3.fromRGB(tonumber(string.sub(hex, 2, 3), 16), tonumber(string.sub(hex, 4, 5), 16), tonumber(string.sub(hex, 6, 7), 16))
end
local function addEffect(rule, part)
    local objects, effect = {}, nil
    local c = color(rule.color)
    if rule.type == "sparkles" then
        effect = Instance.new("Sparkles"); effect.SparkleColor = c
    elseif rule.type == "fire" then
        effect = Instance.new("Fire"); effect.Color = c; effect.SecondaryColor = c; effect.Size = rule.scale; effect.Heat = 4
    elseif rule.type == "smoke" then
        effect = Instance.new("Smoke"); effect.Color = c; effect.Size = rule.scale; effect.Opacity = 0.4; effect.RiseVelocity = 2
    elseif rule.type == "light" then
        effect = Instance.new("PointLight"); effect.Color = c; effect.Brightness = math.min(5, rule.scale); effect.Range = math.min(40, rule.scale * 4)
    elseif rule.type == "trail" then
        local a, b = Instance.new("Attachment"), Instance.new("Attachment")
        a.Position, b.Position = Vector3.new(0, rule.scale * 0.15, 0), Vector3.new(0, -rule.scale * 0.15, 0)
        a.Parent, b.Parent = part, part
        table.insert(objects, a); table.insert(objects, b)
        effect = Instance.new("Trail"); effect.Attachment0 = a; effect.Attachment1 = b
        effect.Color = ColorSequence.new(c); effect.Lifetime = 0.35; effect.FaceCamera = true
    end
    if effect then
        effect.Enabled = false; effect.Name = "MrH_MakerVisual"; effect.Parent = part
        table.insert(objects, effect)
        table.insert(effects, {rule = rule, effect = effect, objects = objects})
    end
end
local function init(figure)
    destroy(); currentFigure = figure
    if not figure then return end
    for _, rule in ipairs(settings.effects) do
        if rule.target == "accessory" then
            for _, item in ipairs(targets(figure, rule.name)) do addEffect(rule, item.part) end
        else
            local part = figure:FindFirstChild(rule.target)
            if part and part:IsA("BasePart") then addEffect(rule, part) end
        end
    end
end
local function relative(rule, time)
    local p, r = rule.offset, rule.rotation
    local phase = math.max(0, time - rule.start) * rule.speed * math.pi * 2
    local x, y, z, angle = p[1], p[2], p[3], 0
    if rule.behavior == "orbit" then x = x + math.cos(phase) * rule.distance; z = z + math.sin(phase) * rule.distance end
    if rule.behavior == "bob" then y = y + math.sin(phase) * rule.distance end
    if rule.behavior == "spin" then angle = phase end
    return CFrame.new(x, y, z) * CFrame.Angles(math.rad(r[1]), math.rad(r[2]) + angle, math.rad(r[3]))
end
local function step(figure, state, time, duration, looped)
    if currentFigure ~= figure then init(figure) end
    if not figure then return end
    time = math.max(0, tonumber(time) or 0)
    if duration and duration > 0 then time = looped and time % duration or math.min(time, duration) end
    restoreBindings()
    for _, entry in ipairs(effects) do
        if entry.effect.Parent then entry.effect.Enabled = active(entry.rule, state, time) end
    end
    local chosen = {}
    for _, rule in ipairs(settings.accessories) do
        if active(rule, state, time) then
            local previous = chosen[rule.name]
            if not previous or rule.state ~= "all" then chosen[rule.name] = rule end
        end
    end
    for named, rule in pairs(chosen) do
        local part = figure:FindFirstChild(rule.part)
        if part and part:IsA("BasePart") and rule.behavior ~= "normal" then
            local offset, mapped = relative(rule, time), false
            if rule.behavior ~= "hidden" and type(HatReanimator) == "table" and type(HatReanimator.GetHatMap) == "function" and type(HatReanimator.HatCFrameOverride) == "table" then
                local ok, map = pcall(HatReanimator.GetHatMap)
                if ok and type(map) == "table" then
                    for _, item in ipairs(map) do
                        if item.Name == named then
                            local override = {Name = named, Limb = rule.part, Offset = offset}
                            table.insert(HatReanimator.HatCFrameOverride, 1, override); ownOverrides[override] = true; mapped = true
                            break
                        end
                    end
                end
            end
            for _, item in ipairs(targets(figure, named)) do
                local weld = item.weld
                if weld and not weld:IsA("Weld") then weld = nil end
                local saved = {part = item.part, transparency = item.part.LocalTransparencyModifier}
                if rule.behavior == "hidden" then
                    item.part.LocalTransparencyModifier = 1
                elseif not mapped and weld then
                    saved.weld, saved.part1, saved.c0, saved.c1 = weld, weld.Part1, weld.C0, weld.C1
                    weld.Part1, weld.C0, weld.C1 = part, CFrame.new(), offset
                end
                table.insert(originals, saved)
            end
        end
    end
end
return {Init = init, Step = step, Destroy = destroy}
