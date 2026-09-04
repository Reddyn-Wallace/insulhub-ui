import "server-only";
import type { PartnerSql } from "./db";
import type { InternalPrincipal } from "./repository";

export type PartnerNotificationSettings={recipientEmail:string|null;revision:number;updatedAt:string};

export class PartnerNotificationSettingsRepository{
  constructor(private readonly sql:PartnerSql,private readonly demo=false){}
  async read(actor:InternalPrincipal):Promise<PartnerNotificationSettings>{
    const result=this.demo
      ?await this.sql.query<Record<string,unknown>>("SELECT recipient_email,revision,updated_at FROM partner_notification_settings WHERE singleton=true")
      :await this.sql.query<Record<string,unknown>>("SELECT * FROM public.partner_settings_notification_get($1)",[actor.userId]);
    const row=result.rows[0];if(!row||!Number.isInteger(Number(row.revision))||Number(row.revision)<0)throw new Error("PARTNER_NOTIFICATION_SETTINGS_UNAVAILABLE");
    const email=row.recipient_email;if(email!==null&&(typeof email!=="string"||email!==email.trim().toLowerCase()||email.length>254||!/^\S+@\S+\.\S+$/.test(email)))throw new Error("PARTNER_NOTIFICATION_SETTINGS_INVALID");
    const updated=new Date(String(row.updated_at));if(!Number.isFinite(updated.getTime()))throw new Error("PARTNER_NOTIFICATION_SETTINGS_INVALID");
    return{recipientEmail:email as string|null,revision:Number(row.revision),updatedAt:updated.toISOString()};
  }
  async update(actor:InternalPrincipal,revision:number,recipientEmail:string):Promise<boolean>{
    if(!Number.isSafeInteger(revision)||revision<0||recipientEmail!==recipientEmail.trim().toLowerCase()||recipientEmail.length>254||!/^\S+@\S+\.\S+$/.test(recipientEmail))throw new Error("PARTNER_NOTIFICATION_SETTINGS_INVALID");
    if(!this.demo){const result=await this.sql.query<Record<string,unknown>>("SELECT public.partner_settings_notification_set($1,$2,$3) AS ok",[actor.userId,revision,recipientEmail]);return result.rows[0]?.ok===true;}
    const result=await this.sql.query("UPDATE partner_notification_settings SET recipient_email=$3,revision=revision+1,updated_by_user_id=$1,updated_at=now() WHERE singleton=true AND revision=$2",[actor.userId,revision,recipientEmail]);return result.rowCount===1;
  }
}
