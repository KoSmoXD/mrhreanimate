local function frame() return setmetatable({}, {__mul=function() return frame() end}) end
CFrame={new=frame,Angles=frame}
Color3={fromRGB=function(...) return {...} end}
ColorSequence={new=function(v) return v end}
Vector3={new=function(...) return {...} end}
local created={}
Instance={new=function(kind)
 local obj={kind=kind,Enabled=false}
 function obj:Destroy() self.Parent=nil;self.destroyed=true end
 table.insert(created,obj);return obj
end}
local weld={Part1="original",C0="c0",C1="c1",Parent=true,IsA=function(_,s) return s=="Weld" end}
local handle={Parent=true,LocalTransparencyModifier=.2,IsA=function(_,s) return s=="BasePart" end,FindFirstChild=function() return weld end}
local hat={Name="Hat",IsA=function(_,s) return s=="Accessory" end,FindFirstChild=function() return handle end}
local torso={IsA=function(_,s) return s=="BasePart" end}
local figure={FindFirstChild=function(_,s) return torso end,GetChildren=function() return {hat} end}
game={GetService=function() return {LocalPlayer={Character=figure}} end}
local other={Name="Untouched"}
HatReanimator={HatCFrameOverride={other},GetHatMap=function() return {{Name="Hat"}} end}
local settings={effects={{type="fire",target="Torso",color="#123456",scale=1,state="walk",start=0,["end"]=1}},accessories={{name="Hat",behavior="orbit",part="Head",offset={0,0,0},rotation={0,0,0},speed=1,distance=2,state="all",start=0}}}
local visuals=(function(settings)
-- INSERT_VISUAL_RUNTIME_HERE
end)(settings)
visuals.Init(figure)
assert(#created==1 and not created[1].Enabled)
visuals.Step(figure,"walk",.5,2,true)
assert(created[1].Enabled and #HatReanimator.HatCFrameOverride==2)
for i=1,5 do visuals.Step(figure,"walk",.6,2,true) end
assert(#HatReanimator.HatCFrameOverride==2,"overrides must not accumulate")
visuals.Step(figure,nil,0,2,true)
assert(not created[1].Enabled and #HatReanimator.HatCFrameOverride==1)
assert(HatReanimator.HatCFrameOverride[1]==other)
settings.accessories[1].behavior="hidden"
visuals.Step(figure,"walk",1.5,2,true)
assert(handle.LocalTransparencyModifier==1 and not created[1].Enabled)
visuals.Destroy()
assert(handle.LocalTransparencyModifier==.2 and created[1].destroyed)
settings.accessories[1].behavior="follow";HatReanimator=nil
visuals.Init(figure);visuals.Step(figure,"walk",.2,2,true)
assert(weld.Part1==torso)
visuals.Destroy();assert(weld.Part1=="original" and weld.C0=="c0" and weld.C1=="c1")
print("visual runtime lifecycle, timing, mapped overrides and weld restoration passed")
