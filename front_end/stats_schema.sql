create table instances (
	project_id varchar(36),
	uuid varchar(36),
	name varchar(64),
	vcpus int,
	memory int,
	local int,
	volume_total int,
	wall_time int,
	cpu_time int,
	primary key (uuid),
	foreign key (project_id) references projects(uuid)
);

create table projects (
	uuid varchar(36),
	display_name varchar(64),
	quota_instances int,
	quota_vcpus int,
	quota_memory int,
	quota_volume_total int,
	quota_snapshot int,
	quota_volume_count int,
	primary key (uuid)
);
