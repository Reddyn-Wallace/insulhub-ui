// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InsulHubDrawingCanvas from "@/components/InsulHubDrawingCanvas";
import { EMPTY_SITE_PLAN_DOCUMENT, type SitePlanDrawingDocument } from "../site-plan-drawings";

const connected: SitePlanDrawingDocument = { ...EMPTY_SITE_PLAN_DOCUMENT, walls: [
  { id: "one", start: {x:2,y:3}, end:{x:6,y:3}, style:"solid" },
  { id: "two", start: {x:6,y:3}, end:{x:6,y:7}, style:"solid" },
] };
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { constructor(private cb: ResizeObserverCallback) {} observe() { this.cb([{contentRect:{width:916,height:866}}] as ResizeObserverEntry[], this as unknown as ResizeObserver); } disconnect() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId=1; pointerType="mouse"; });
  Object.defineProperty(SVGElement.prototype,"setPointerCapture",{configurable:true,value:vi.fn()});
  Object.defineProperty(SVGElement.prototype,"releasePointerCapture",{configurable:true,value:vi.fn()});
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({measureText:(text:string)=>({width:text.length*8})} as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function Harness({initial=EMPTY_SITE_PLAN_DOCUMENT}:{initial?:SitePlanDrawingDocument}) {
  const [value,setValue]=useState(initial);
  return <><InsulHubDrawingCanvas value={value} onChange={setValue}/><output data-testid="document">{JSON.stringify(value)}</output></>;
}
function canvas() { const svg=screen.getByRole("img",{name:"Floor plan drawing"}); vi.spyOn(svg,"getBoundingClientRect").mockReturnValue({x:0,y:0,left:0,top:0,right:900,bottom:850,width:900,height:850,toJSON:()=>({})}); return svg; }
function pointer(svg:HTMLElement,event:"pointerDown"|"pointerMove"|"pointerUp",x:number,y:number) { fireEvent[event](svg,{clientX:x*50,clientY:y*50,bubbles:true}); }
function current():SitePlanDrawingDocument { return JSON.parse(screen.getByTestId("document").textContent!); }

describe("original InsulHub canvas in the partner portal",()=>{
  it("enlarges the grid and pans without modifying the drawing",()=>{
    render(<Harness initial={connected}/>);
    const svg=canvas();const paper=svg.parentElement!;
    const originalWidth=parseFloat(paper.style.width);
    fireEvent.change(screen.getByRole("combobox",{name:"Drawing zoom"}),{target:{value:"2"}});
    expect(parseFloat(paper.style.width)).toBe(originalWidth*2);
    fireEvent.click(screen.getByRole("button",{name:"Pan"}));
    expect(svg.style.pointerEvents).toBe("none");
    const viewport=paper.parentElement!.parentElement!;
    Object.defineProperty(viewport,"setPointerCapture",{value:vi.fn()});
    fireEvent.pointerDown(viewport,{clientX:200,clientY:200});
    fireEvent.pointerMove(viewport,{clientX:100,clientY:120});
    fireEvent.pointerUp(viewport);
    expect(viewport.scrollLeft).toBe(100);expect(viewport.scrollTop).toBe(80);
    expect(current()).toEqual(connected);
    fireEvent.change(screen.getByRole("combobox",{name:"Drawing zoom"}),{target:{value:"1"}});
    expect(parseFloat(paper.style.width)).toBe(originalWidth);
  });
  it("draws a continuous outline, closes the shape, then undoes using the original toolbar",()=>{
    render(<Harness/>); const svg=canvas();
    for(const [x,y] of [[2,3],[6,3],[6,7],[2,7]]) pointer(svg,"pointerDown",x,y);
    expect(current().walls).toHaveLength(3);
    fireEvent.click(screen.getByRole("button",{name:"Close"}));
    expect(current().walls).toHaveLength(4);
    expect(current().walls[3].end).toEqual(current().walls[0].start);
    expect(screen.getByRole("button",{name:"+ Wall"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Undo"})); expect(current().walls).toHaveLength(3);
  });
  it("physically resizes a wall and moves the connected corner",()=>{
    render(<Harness initial={connected}/>);const svg=canvas();fireEvent.click(screen.getByRole("button",{name:"Edit"}));
    pointer(svg,"pointerDown",4,3);pointer(svg,"pointerUp",4,3);
    fireEvent.click(screen.getByRole("button",{name:"+0.5"}));
    expect(current().walls[0].end).toEqual({x:6.5,y:3});expect(current().walls[1].start).toEqual({x:6.5,y:3});
  });
  it("drags endpoints while preserving adjoining wall connections",()=>{
    render(<Harness initial={connected}/>);const svg=canvas();fireEvent.click(screen.getByRole("button",{name:"Edit"}));
    pointer(svg,"pointerDown",4,3);pointer(svg,"pointerUp",4,3);
    pointer(svg,"pointerDown",6,3);pointer(svg,"pointerMove",7,4);pointer(svg,"pointerUp",7,4);
    expect(current().walls[0].end).toEqual({x:7,y:4});expect(current().walls[1].start).toEqual({x:7,y:4});
  });
  it("drags the whole wall and keeps neighbouring endpoints attached",()=>{
    render(<Harness initial={connected}/>);const svg=canvas();fireEvent.click(screen.getByRole("button",{name:"Edit"}));
    pointer(svg,"pointerDown",4,3);pointer(svg,"pointerMove",5,4);pointer(svg,"pointerUp",5,4);
    expect(current().walls[0].start).toEqual({x:3,y:4});expect(current().walls[0].end).toEqual(current().walls[1].start);
  });
  it("places and edits text inline instead of through coordinate fields",()=>{
    render(<Harness/>);const svg=canvas();fireEvent.click(screen.getByRole("button",{name:"Edit"}));fireEvent.click(screen.getByRole("button",{name:"+ Text"}));
    pointer(svg,"pointerDown",5,5);const text=screen.getByRole("textbox");fireEvent.change(text,{target:{value:"Kitchen\nUpper floor"}});fireEvent.blur(text);
    expect(current().textNotes[0].text).toBe("Kitchen\nUpper floor");
    expect(screen.queryByText("Add a wall with coordinates")).toBeNull();
  });
  it("rotates a selected wall freely while preserving its length",()=>{
    render(<Harness initial={{...connected,walls:[connected.walls[0]]}}/>);const svg=canvas();
    fireEvent.click(screen.getByRole("button",{name:"Edit"}));pointer(svg,"pointerDown",4,3);pointer(svg,"pointerUp",4,3);
    pointer(svg,"pointerDown",4,2.1);pointer(svg,"pointerMove",5,2.5);pointer(svg,"pointerUp",5,2.5);
    const {start,end}=current().walls[0];expect(end.y).not.toBeCloseTo(start.y);expect(end.x).not.toBeCloseTo(start.x);
    expect(Math.hypot(end.x-start.x,end.y-start.y)).toBeCloseTo(4);
    fireEvent.click(screen.getByRole("button",{name:"Undo"}));expect(current().walls[0]).toEqual(connected.walls[0]);
  });
  it("does not emit mutations when read-only or when adopting externally recovered data",()=>{
    const change=vi.fn();const view=render(<InsulHubDrawingCanvas value={connected} onChange={change} disabled/>);
    const svg=view.container.querySelector("svg")!;fireEvent.pointerDown(svg,{clientX:200,clientY:200});expect(change).not.toHaveBeenCalled();
    expect(view.container.querySelector("[inert]")).toBeTruthy();
    view.rerender(<InsulHubDrawingCanvas value={{...connected,showDimensions:false}} onChange={change}/>);
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("button",{name:"Labels OFF"})).toBeTruthy();
  });
});
