Profile folders group edited entity text per map (same format as Open entities .txt / BSP lump: { } blocks, CRLF ok).

Layout (bundled in the app under entity-profiles/):

  entity-profiles/<profile-name>/<sof1maps-path-without-.zip>.txt

Example: map zip dm/iraq_small.zip → file

  entity-profiles/myprofile/dm/iraq_small.txt

Export (Entities tab) with a profile selected downloads a zip that unpacks to:

  <profile-name>/dm/iraq_small.txt

at the repository root (same relative path, without the entity-profiles/ prefix in the zip).

Switching profile loads a different file for the same loaded map when that path exists in the bundle.
