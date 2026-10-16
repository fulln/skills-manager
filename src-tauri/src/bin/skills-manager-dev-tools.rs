//! Explicit headless entry points for the isolated development data only.
use app_lib::core::{app_state,central_repo,usage,usage_local};
fn main()->Result<(),Box<dyn std::error::Error>>{
 let args:Vec<String>=std::env::args().collect();
 let (store,_)=app_state::initialize_store()?;
 let result=match args.get(1).map(String::as_str){
  Some("status")=>serde_json::to_value(usage::status().map_err(std::io::Error::other)?)?,
  Some("collect-local")=>serde_json::to_value(usage_local::import(store.get_all_skills()?.into_iter().map(|s|s.name).collect()).map_err(std::io::Error::other)?)?,
  Some("import-nmem")=>{
   let skill=args.get(2).ok_or("usage: skills-manager-dev-tools import-nmem SKILL [PROJECT_ID]")?;
   serde_json::to_value(usage::import_nmem(usage::NmemImportRequest{skill:skill.clone(),project:args.get(3).cloned(),agent:None,query:None,space:None,limit:Some(5)}).map_err(std::io::Error::other)?)?
  },
  Some("summary")=>serde_json::to_value(usage::summaries(None,None).map_err(std::io::Error::other)?)?,
  _=>return Err("usage: skills-manager-dev-tools status|collect-local|import-nmem SKILL [PROJECT_ID]|summary".into())
 };
 eprintln!("Isolated data root: {}",central_repo::base_dir().display());
 println!("{}",serde_json::to_string_pretty(&result)?);Ok(())
}
