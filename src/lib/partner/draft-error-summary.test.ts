import { describe, expect, it } from "vitest";
import { summariseDraftErrors } from "./draft-error-summary";

describe("submission checklist", () => {
  it("combines missing product values and removes repetitive field prefixes", () => {
    expect(summariseDraftErrors([
      ["address", "The full site address will be required."],
      ["contact", "A phone number or email will be required."],
      ["customerName", "Customer name will be required."],
      ["wall.areaSqm", "Wall area must be greater than zero."],
      ["wall.rateCentsPerSqm", "Wall rate must be greater than zero."],
      ["ceiling.rValue", "Ceiling R-value must be greater than zero."],
      ["floorPlan", "Add at least one floor plan."],
    ])).toEqual([
      {path:"address",message:"Complete the site address.",simple:true},
      {path:"contact",message:"Add a phone number or email.",simple:true},
      {path:"customerName",message:"Add a customer name.",simple:true},
      {path:"wall.areaSqm",message:"Enter wall area and rate above 0.",simple:true},
      {path:"ceiling.rValue",message:"Enter ceiling R-value above 0.",simple:true},
      {path:"floorPlan",message:"Add a floor plan.",simple:true},
    ]);
  });
  it("preserves specific errors rather than replacing them with generic missing-field warnings", () => {
    expect(summariseDraftErrors([["wall.areaSqm","The maximum area is 1000."],["floorPlan","Ground floor must be marked complete."]])).toEqual([
      {path:"wall.areaSqm",message:"The maximum area is 1000.",simple:false},
      {path:"floorPlan",message:"Ground floor must be marked complete.",simple:true},
    ]);
  });
});
