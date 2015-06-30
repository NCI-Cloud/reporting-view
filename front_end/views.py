import os, random, math
import uuid
import sqlite3

from django.shortcuts import render
from django.http import HttpResponse
from django.template import RequestContext, loader

dbfile="/home/sjjf/NCI/reporting/sample_data.sqlite3"

class Project:
        def __init__(self, name):
                self._instance_loading = random.random()
                self.uuid = str(uuid.uuid4())
                self.display_name = name
                self.quota_instances = random.randint(5, 30)
                self.quota_vcpus = random.randrange(25, 300, 25)
                self.quota_memory = self.quota_vcpus * 4
                self.quota_volume_total = self.quota_instances * 250
                self.quota_snapshot = math.ceil(self.quota_instances/2)
                self.quota_volume_count = self.quota_instances + 5

                self.instances = []
                for i in range(0, int(self._instance_loading*self.quota_instances)):
                        self.instances.append(Instance(self, i))

        def insert(self, db):
                c = db.cursor()
                c.execute("insert into projects values (?, ?, ?, ?, ?, ?, ?, ?)",
                        (self.uuid, self.display_name, self.quota_instances,
                        self.quota_vcpus, self.quota_memory, self.quota_volume_total,
                        self.quota_snapshot, self.quota_volume_count))
                db.commit()

        # recreate this object from the database
	@classmethod
        def from_db(cls, db, id):
                c = db.cursor()
                c.execute("select * from projects where uuid = ?", (id,))
                r = c.fetchone()
		p = cls("")
                p.display_name = r['display_name']
                p.uuid = r['uuid']
                p.quota_instances = r['quota_instances']
                p.quota_vcpus = r['quota_vcpus']
                p.quota_memory = r['quota_memory']
                p.quota_volume_total = r['quota_volume_total']
                p.quota_snapshot = r['quota_snapshot']
                p.quota_volume_count = r['quota_volume_count']
		return p

        def instances_from_db(self, db):
                c = db.cursor()
                c.execute("select uuid from instances where project_id = ?", (self.uuid,))
                self.instances = []
                for row in c.fetchall():
			t = Instance.from_db(db, row['uuid'])
                        self.instances.append(t)

	def get_aggregates(self):
		self.instance_count = len(self.instances)
		self.vcpus = 0
		self.memory = 0
		self.local = 0
		self.volume_total = 0
		self.wall_time = 0
		self.cpu_time = 0
		for i in self.instances:
			self.vcpus += i.vcpus
			self.memory += i.memory
			self.local += i.local
			self.volume_total += i.volume_total
			self.wall_time += i.wall_time
			self.cpu_time += i.cpu_time
		self.efficiency = self.cpu_time*100/self.wall_time

class Instance:
        def __init__(self, project=None, instance_counter=0):
                self.uuid = str(uuid.uuid4())
		if project:
			self.project_id = project.uuid
			self.name = "%s - %d" % (project.display_name, instance_counter)
                self.vcpus = random.randint(0, 8)
                self.memory = self.vcpus * 4
                self.local = random.choice([20, 40, 120])
                self.volume_total = random.choice([50, 100, 250, 500])
                self.wall_time = random.randrange(3600, 3600*100, 1800)
                self.cpu_time = self.wall_time * random.random()

	@classmethod
        def from_db(cls, db, id):
                c = db.cursor()
                c.execute("select * from instances where uuid = ?", (id,))
                r = c.fetchone()
		i = cls()
                i.uuid = r['uuid']
                i.project_id = r['project_id']
                i.name = r['name']
                i.vcpus = r['vcpus']
                i.memory = r['memory']
                i.local = r['local']
                i.volume_total = r['volume_total']
                i.wall_time = r['wall_time']
                i.cpu_time = r['cpu_time']
		return i

        def insert(self, db):
                c = db.cursor()
                c.execute("insert into instances values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (self.project_id, self.uuid, self.name, self.vcpus, self.memory,
                        self.local, self.volume_total, self.wall_time, self.cpu_time))
                db.commit()



# aggregate queries . . .

total_resources_used = """
select 
	sum(vcpus) as cores, 
	sum(memory) as memory, 
	sum(local) as storage, 
	sum(volume_total) as ceph 
from instances
"""

current_usage = """
select 
	count(*) as instances, 
	sum(wall_time) as wall_time, 
	sum(cpu_time) as cpu_time, 
	cpu_time*100/wall_time as usage 
from instances;
"""

top_projects = """
select 
	p.uuid as uuid, 
	p.display_name as project, 
	count(i.uuid) as instances, 
	sum(i.vcpus) as cores, 
	sum(i.memory) as memory, 
	sum(i.local) as local, 
	sum(i.volume_total) as ceph 
from 
	instances as i join projects p 
	on i.project_id = p.uuid 
group by p.uuid 
order by cores desc
"""

# the available resources
class Overview:
	def __init__(self):
		conn = sqlite3.connect(dbfile)
		conn.row_factory = sqlite3.Row
		c = conn.cursor()

		self.vcpus = 3200
		self.memory = 128*100
		self.local = 700*100
		self.ceph = 10*1024*1024
		
		c.execute(total_resources_used)
		r = c.fetchone()
		(self.vcpus_used, self.memory_used, self.local_used, self.ceph_used) = r

		c.execute(current_usage)
		r = c.fetchone()
		(self.instance_count, self.wall_time, self.cpu_time, self.eff) = r

		self.historical_instance_count = 0
		self.historical_wall_time = 0
		self.historical_cpu_time = 0
		self.historical_eff = 0

		self.top_projects = []
		c.execute(top_projects)
		for r in c.fetchall():
			t = Project.from_db(conn, r['uuid'])
			t.instances_from_db(conn)
			t.get_aggregates()
			self.top_projects.append(t)

# Create your views here.

def base(request):
	template = loader.get_template('front_end/overview.html')
	context = RequestContext(request, {
		'overview': Overview(),
	})
	return HttpResponse(template.render(context))

def project(request, project_id):
	conn = sqlite3.connect(dbfile)
	conn.row_factory = sqlite3.Row
	template = loader.get_template('front_end/project.html')
	p = Project.from_db(conn, project_id)
	p.instances_from_db(conn)
	p.get_aggregates()
	context = RequestContext(request, {
		'project': p,
	})
	return HttpResponse(template.render(context))


