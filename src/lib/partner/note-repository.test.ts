import { describe, expect, it } from "vitest";
import { createPartnerTestDatabase } from "./test-db";
import { PartnerOperationsRepository } from "./operations-repository";
import { PartnerNoteRepository } from "./note-repository";

const companyId="11111111-1111-4111-8111-111111111111", jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const principal={userId:"partner",principalType:"PARTNER" as const,companyId};
describe("demo partner notes",()=>{
  it("shows attributed updates and keeps read receipts private, bounded and monotonic",async()=>{
    const {Pool}=createPartnerTestDatabase();const pool=new Pool();
    try {
      await pool.query("INSERT INTO partner_companies(id,slug,name,billing_model) VALUES($1,'notes','Notes','INSULHUB_BILLED')",[companyId]);
      await pool.query("INSERT INTO partner_users(id,company_id,principal_type,name,email,ops_role) VALUES('admin',NULL,'INTERNAL','Admin','admin@test','ADMIN'),('partner',$1,'PARTNER','Partner','partner@test',NULL),('second',$1,'PARTNER','Second','second@test',NULL)",[companyId]);
      await pool.query("INSERT INTO partner_jobs(id,company_id,created_by_user_id,client_reference,submission_state,billing_model_snapshot,submission_started_at,submitted_at) VALUES($1,$2,'partner','A-1','SUBMITTED','INSULHUB_BILLED',now(),now())",[jobId,companyId]);
      const notes=new PartnerNoteRepository(pool,true),ops=new PartnerOperationsRepository(pool,true);
      expect(await notes.feed(principal,jobId)).toEqual({updates:[],latestSequence:0,readSequence:0});
      await ops.appendAmendment({userId:'admin',principalType:'INTERNAL',companyId:null},companyId,jobId,{description:'Ready to schedule',authorName:'Test Author',legacyActorId:'aaaaaaaaaaaaaaaaaaaaaaaa'});
      expect(await notes.feed(principal,jobId)).toMatchObject({latestSequence:1,readSequence:0,updates:[{description:'Ready to schedule',authorName:'Test Author'}]});
      expect(await notes.feed(principal,jobId,1)).toMatchObject({readSequence:1});
      expect(await notes.feed(principal,jobId,0)).toMatchObject({readSequence:1});
      expect(await notes.feed({...principal,userId:'second'},jobId)).toMatchObject({readSequence:0});
      await expect(notes.feed(principal,jobId,2)).rejects.toThrow('UPDATE_INVALID');
      expect(await notes.summaries(principal)).toEqual([{id:jobId,latestSequence:1,readSequence:1}]);
      expect(await notes.feed({...principal,companyId:'22222222-2222-4222-8222-222222222222'},jobId)).toBeNull();
      await pool.query("UPDATE partner_users SET disabled_at=now() WHERE id='partner'");
      expect(await notes.feed(principal,jobId)).toBeNull();
    } finally {await pool.end();}
  });
});
