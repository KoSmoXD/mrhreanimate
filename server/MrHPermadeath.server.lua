-- Mr H Reanimate: optional SERVER-AUTHORITATIVE permadeath bridge.
-- Install in ServerScriptService in a Roblox experience YOU CONTROL.
-- IMPORTANT: This script takes over respawning for EVERY player; do not
-- combine it with another custom respawn controller without integration.
-- It must run at server startup, BEFORE players join.
--
-- A client cannot make an arbitrary third-party server run this script.
-- This module only establishes genuine server-recognized death in your game;
-- it cannot guarantee that a client-only reanimated hat rig remains visible.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

Players.CharacterAutoLoads = false

local BRIDGE_NAME = "MrHPermadeathBridge"
local bridge = ReplicatedStorage:FindFirstChild(BRIDGE_NAME)
if bridge and not bridge:IsA("RemoteEvent") then
    error("Mr H: "..BRIDGE_NAME.." must be a RemoteEvent")
end
if not bridge then
    bridge = Instance.new("RemoteEvent")
    bridge.Name = BRIDGE_NAME
    bridge.Parent = ReplicatedStorage
end

local active = {}
local generations = {}
local spawning = {}

local function spawnPlayer(player)
    if not player:IsDescendantOf(Players) or spawning[player] then return end
    spawning[player] = true
    generations[player] = (generations[player] or 0) + 1
    task.spawn(function()
        local ok, err = pcall(function() player:LoadCharacterAsync() end)
        if not ok then warn("[Mr H FE] Spawn error: "..tostring(err)) end
        spawning[player] = nil
    end)
end

local function onCharacter(player, character)
    local charGeneration = generations[player]
    local humanoid = character:WaitForChild("Humanoid", 10)
    if not humanoid then return end
    humanoid.Died:Connect(function()
        if active[player] then return end
        task.delay(math.max(0.1, Players.RespawnTime), function()
            if player:IsDescendantOf(Players)
                and not active[player]
                and generations[player] == charGeneration then
                spawnPlayer(player)
            end
        end)
    end)
end

local function setupPlayer(player)
    active[player] = false
    generations[player] = 0
    player:SetAttribute("MrHServerPermadeath", false)
    player.CharacterAdded:Connect(function(character)
        onCharacter(player, character)
    end)
    spawnPlayer(player)
end

Players.PlayerAdded:Connect(setupPlayer)
Players.PlayerRemoving:Connect(function(player)
    active[player], generations[player], spawning[player] = nil, nil, nil
end)
for _, player in Players:GetPlayers() do
    setupPlayer(player)
end

bridge.OnServerEvent:Connect(function(player, command)
    if command == "Enable" then
        if active[player] then
            bridge:FireClient(player, "Active")
            return
        end
        local character = player.Character
        local humanoid = character and character:FindFirstChildOfClass("Humanoid")
        if not humanoid or humanoid.Health <= 0 then
            bridge:FireClient(player, "Rejected")
            return
        end
        -- Only the requesting player's OWN character may be killed.
        active[player] = true
        player:SetAttribute("MrHServerPermadeath", true)
        humanoid.Health = 0 -- authoritative death on the server
        bridge:FireClient(player, "Active")
    elseif command == "Disable" then
        if not active[player] then return end
        active[player] = false
        player:SetAttribute("MrHServerPermadeath", false)
        spawnPlayer(player) -- resume by creating a server-owned character
        bridge:FireClient(player, "Disabled")
    end
end)
