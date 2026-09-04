// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({request:vi.fn(),confirm:vi.fn()}));
vi.mock("./settings-client",()=>({settingsRequest:mocks.request}));
vi.mock("@/components/AppDialog",()=>({useAppDialog:()=>({confirm:mocks.confirm,dialog:null})}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
import { PartnerCompanyManagement, Users } from "@/components/PartnerOpsCompanies";
const company={id:"11111111-1111-4111-8111-111111111111",name:"Test Partner",revision:3,isActive:true};
const employee={id:"employee",name:"Taylor",email:"taylor@example.test",disabledAt:"2026-09-01",role:"SALES"};
beforeEach(()=>{mocks.request.mockReset();mocks.confirm.mockReset();});
afterEach(cleanup);

describe("company lifecycle and roles",()=>{
  it("requires archive confirmation and uses the current revision",async()=>{
    mocks.request.mockImplementation(async (_url:string,method:string)=>method==="PATCH"?{ok:true}:_url.endsWith("/connection")?{status:{configured:false}}:{companies:[{...company,isActive:false,revision:4}]});
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<PartnerCompanyManagement initialCompany={company}/>);
    await screen.findByText("Not connected");
    fireEvent.click(screen.getByRole("button",{name:"Archive company"}));
    await waitFor(()=>expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.request.mock.calls.some(([,method])=>method==="PATCH")).toBe(false);
    fireEvent.click(screen.getByRole("button",{name:"Archive company"}));
    await screen.findByText("Company archived. All employees are inactive.");
    expect(mocks.request).toHaveBeenCalledWith(`/api/settings/partners/${company.id}`,"PATCH",{revision:3,isActive:false});
    expect(screen.getByLabelText("InsulHub email")).toHaveProperty("disabled",true);
  });
  it("locks user controls during archive and after an uncertain result",async()=>{
    let rejectArchive!: (error:Error)=>void;
    mocks.confirm.mockResolvedValue(true);
    mocks.request.mockImplementation(async(url:string,method:string)=>method==="PATCH"?new Promise((_resolve,reject)=>{rejectArchive=reject;}):url.endsWith("/users")?{users:[employee]}:{status:{configured:false}});
    render(<PartnerCompanyManagement initialCompany={company} created/>);
    await screen.findByRole("button",{name:"Reactivate"});
    fireEvent.click(screen.getByRole("button",{name:"Archive company"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Reactivate"})).toHaveProperty("disabled",true));
    expect(screen.getByRole("button",{name:"Send invitation"})).toHaveProperty("disabled",true);
    rejectArchive(new Error("Response lost"));
    await screen.findByText("Response lost");
    expect(screen.getByRole("button",{name:"Reactivate"})).toHaveProperty("disabled",true);
    expect(screen.getByRole("button",{name:"Users"})).toHaveProperty("disabled",true);
  });
  it("unarchives without automatically enabling employees",async()=>{
    mocks.confirm.mockResolvedValue(true);
    mocks.request.mockImplementation(async(url:string)=>url.endsWith("/connection")?{status:{configured:false}}:url.endsWith("/users")?{users:[employee]}:{companies:[{...company,revision:5}]});
    render(<PartnerCompanyManagement initialCompany={{...company,isActive:false}}/>);
    fireEvent.click(screen.getByRole("button",{name:"Unarchive company"}));
    await screen.findByText("Company unarchived. Reactivate employees individually from Users.");
    fireEvent.click(screen.getByRole("button",{name:"Users"}));
    expect(await screen.findByRole("button",{name:"Reactivate"})).toHaveProperty("disabled",false);
    expect(mocks.request.mock.calls.filter(([,method])=>method==="PATCH")).toHaveLength(1);
  });
  it("reactivates an employee and persists role changes through the partner scoped API",async()=>{
    let active=false,role="SALES";
    mocks.request.mockImplementation(async(_url:string,method:string,body:{isActive?:boolean;role?:string}|undefined)=>{
      if(method==="PATCH"){active=body?.isActive??active;role=body?.role??role;return {ok:true};}
      return {users:[{...employee,disabledAt:active?null:employee.disabledAt,role}]};
    });
    render(<Users companyId={company.id} companyName={company.name} onLock={vi.fn()} partnerMode currentUserId="admin"/>);
    fireEvent.click(await screen.findByRole("button",{name:"Reactivate"}));
    await screen.findByText("User reactivated.");
    expect(mocks.request).toHaveBeenCalledWith("/api/partner/users/employee","PATCH",{isActive:true});
    expect(screen.queryByRole("button",{name:"Reactivate"})).toBeNull();
    fireEvent.change(screen.getByLabelText("Role for Taylor"),{target:{value:"ADMIN"}});
    await screen.findByText("User role updated.");
    expect(mocks.request).toHaveBeenCalledWith("/api/partner/users/employee","PATCH",{role:"ADMIN"});
    expect(screen.getByLabelText("Role for Taylor")).toHaveProperty("value","ADMIN");
  });
  it("blocks additions/reactivation for archived companies and self-disable in partner management",async()=>{
    mocks.request.mockResolvedValue({users:[employee]});
    const view=render(<Users companyId={company.id} companyName={company.name} onLock={vi.fn()} companyActive={false}/>);
    expect(await screen.findByRole("button",{name:"Reactivate"})).toHaveProperty("disabled",true);
    expect(screen.getByRole("button",{name:"Send invitation"})).toHaveProperty("disabled",true);
    view.unmount();mocks.request.mockResolvedValue({users:[{...employee,disabledAt:null,role:"ADMIN"}]});
    render(<Users companyId={company.id} companyName={company.name} onLock={vi.fn()} partnerMode currentUserId={employee.id}/>);
    expect(await screen.findByRole("button",{name:"Disable"})).toHaveProperty("disabled",true);
    expect(screen.getByLabelText("Role for Taylor")).toHaveProperty("disabled",true);
  });
  it("locks further actions if refreshing users after a mutation fails",async()=>{
    mocks.request.mockResolvedValueOnce({users:[employee]}).mockResolvedValueOnce({ok:true}).mockRejectedValueOnce(new Error("Network interrupted"));
    render(<Users companyId={company.id} companyName={company.name} onLock={vi.fn()}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Reactivate"}));
    await screen.findByRole("button",{name:"Reload latest details"});
    expect(screen.getByRole("button",{name:"Reactivate"})).toHaveProperty("disabled",true);
    expect(screen.queryByText("User reactivated.")).toBeNull();
  });
});
