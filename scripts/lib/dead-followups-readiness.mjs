// Storage-only, read-only checks. This is not a live provider or canonical API test.
const required={
 dead_quote_dates:['insulhub_job_id','entry','pending','updated_at'],
 dead_quote_date_events:['id','insulhub_job_id','kind','entry','actor_id','actor_name','observed_at'],
 dead_quote_followup_controls:['insulhub_job_id','revision','state','actor_name','updated_at'],
 dead_quote_followup_events:['insulhub_job_id','revision','action','state','actor_id','actor_name','quote_version'],
 dead_quote_followup_attempts:['id','request_id','insulhub_job_id','snapshot','approach','status','sent_at','note_status','actor_id','actor_name','failure_reason','created_at'],
 dead_quote_followup_verifications:['attempt_id','actor_id','actor_name','evidence','verified_at'],
 dead_quote_followup_templates:['singleton','revision','templates','actor_name','updated_at'],
 dead_quote_followup_template_events:['revision','templates','actor_id','actor_name','created_at'],
 job_sms_messages:['id','insulhub_job_id','status','body','request_hash','provider_message_id','failure_reason'],
 job_email_messages:['id','insulhub_job_id','status','body','rendered_body','rendered_html','request_hash','rfc_message_id','failure_reason']
};
export async function checkReadiness(client){
 const missing=[];
 for(const [table,columns] of Object.entries(required)){
  const {rows}=await client.query('SELECT attname FROM pg_attribute WHERE attrelid=to_regclass($1) AND attnum>0 AND NOT attisdropped',[table]);
  const present=new Set(rows.map(row=>row.attname));
  for(const column of columns)if(!present.has(column))missing.push(table+'.'+column);
 }
 const unique=await client.query("SELECT indisunique,indisvalid,pg_get_expr(indpred,indrelid) AS predicate FROM pg_index WHERE indexrelid=to_regclass('dead_quote_followup_one_active_approach')");
 if(!unique.rows[0]?.indisunique||!unique.rows[0]?.indisvalid||!unique.rows[0]?.predicate?.includes('failed'))missing.push('one active approach uniqueness guard');
 for(const [table,trigger] of [['dead_quote_date_events','dead_quote_date_events_immutable'],['dead_quote_followup_events','dead_quote_followup_events_immutable'],['dead_quote_followup_attempts','dead_quote_followup_snapshot_immutable'],['dead_quote_followup_verifications','dead_quote_verification_immutable'],['dead_quote_followup_template_events','dead_quote_template_event_immutable']]){
  const {rows}=await client.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2",[table,trigger]);if(!rows[0]||!['O','A'].includes(rows[0].tgenabled))missing.push(trigger);
 }
 return {ready:missing.length===0,missing};
}
