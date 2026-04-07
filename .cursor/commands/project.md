# project

A sof map is a .bsp file based on Quake-2 albeit some changes. Its your job to find and document these changes such that any .bsp file from Soldier Of Fortune can be loaded into this web-gl based renderer. The ent_files directory contains the entity sections of every bsp map as .txt files. Maps live within sub folders like dm , exp etc. These are just common naming conventions like deathmatch , expanded . Most of the time we use dm .

All maps .bsp file can be downloaded from https://github.com/plowsof/sof1maps/blob/main/dm/doom2sof.zip , for eg. dm/doom2sof.bsp 

This .zip folder also contains the relative assets the map needs, so you will find maps/dm/doom2sof.bsp , textures/subfolder/atexture.m32 etc...

The ida-connector mcp tool can be used to interact with open instances of ida which currently are the player.so (Used for shared weapon and inventory prediction code), gamex86.so (Server side code), ref_gl.so (Client renderer code) , sof-bin (Client and Server core engine code).

You have free access to all functions, disassembly and xrefs to build a complete picture of the program.

This project that you are building will be a webl-gl based renderer that loads any given .bsp .  You can then extract the entity section from the bsp or use the provided ent_files directory. The entity section should then be rendered into the bsp 3d view so that all entities position can be observed and manipulated in 3d-space. The final output should be a new entity file with what-ever the user changed visually.

This is useful because the SoF Server can input modified ent_files to change the default spawns of a map.
